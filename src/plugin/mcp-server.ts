/**
 * Servidor de herramientas de la misión.
 *
 * El plugin entrega al agente un juego pequeño de herramientas para que
 * pueda mirar la misión, proponer el siguiente trabajo y mandar órdenes sin
 * salir de la conversación. El servidor habla MCP sobre la entrada y salida
 * estandar, así que lo manages el propio programa.
 *
 * Reparto de escrituras: el journal lo sigue escribiendo quien encadena
 * objetivos. Este servidor solo escribe en el canal de control y en el
 * fichero de propuestas, que son ficheros aparte precisamente para que dos
 * procesos no se pisen.
 */
import { createInterface } from 'node:readline';
import { existsSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FileControlPort } from '../adapters/control.js';
import { FileJournal } from '../adapters/journal.js';
import { ComposedCandidatePort } from '../adapters/candidates.js';
import { buildCandidatePorts } from '../runtime.js';
import { toMission, declareMission } from '../adapters/mission.js';
import { ensureWorkdir } from '../adapters/workdir.js';
import {
  evidenceExists,
  proposalsToCandidates,
  reviewProposals,
  writeProposal,
} from '../adapters/proposals.js';
import { completedObjectives, isCompleted } from '../adapters/ledger.js';
import { cycleViewOf, driverLine, renderCycleView, whyNotChained, type CycleWorkItem } from '../core/cycle-view.js';
import { freshJournal, normalize, type Journal, type Mission } from '../core/types.js';
import { locateMission, type LocatedMission } from './mission-locator.js';
import type { Logger } from '../ports.js';

/** Version del protocolo MCP que se anuncia por defecto. */
const PROTOCOL_VERSION = '2024-11-05';

/**
 * Recurso del protocolo: algo que se puede abrir y leer sin ser una accion.
 *
 * La vista del ciclo tambien se expone como recurso porque hay dos maneras de
 * quererla: como herramienta, cuando el agente decide mirar, y como recurso,
 * cuando el host lo ofrece para abrirlo. Las dos devuelven el mismo texto.
 */
export interface McpResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  read(): Promise<string>;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run(args: Record<string, unknown>): Promise<string>;
}

export interface MissionToolsOptions {
  /** Directorio desde el que se busca la declaración de la misión. */
  cwd: string;
  logger: Logger;
  /** Reloj, inyectado para que las pruebas no dependan del reloj real. */
  now?: () => number;
}

/**
 * El trabajo que ya está hecho: lo que dice el ledger del workspace y lo que
 * la cadena ya encadenó.
 *
 * Son dos fuentes porque son dos hechos distintos: el ledger es la memoria del
 * proyecto y el estado interno es la memoria de la cadena. Ninguna de las dos
 * basta sola, y ofrecer trabajo ya pagado es la forma más cara de perder un
 * ciclo.
 */
function completedWork(missionPath: string, state: Journal | null): Set<string> {
  const completed = new Set(completedObjectives(missionPath));
  for (const intent of state?.intents ?? []) {
    if (intent.status === 'committed') completed.add(normalize(intent.objective));
  }
  return completed;
}

/** Como se dice de donde sale un trabajo pendiente. */
function originOf(source: string): CycleWorkItem['origin'] {
  if (source === 'investigation') return 'propuesta';
  if (source === 'observed') return 'exploracion';
  return 'backlog';
}

/** Lo que se dice cuando en este workspace no hay ninguna mision declarada. */
function withoutMissionText(options: MissionToolsOptions): string {
  return (
    'No hay ninguna misión declarada en este workspace. ' +
    'Declárala con la herramienta mission_declare: necesita un objetivo y se ' +
    'encarga del resto. Si la herramienta no está disponible, crea un fichero ' +
    'goal-compass.json en la raíz del repositorio con missionId, objective y ' +
    'backlog.\n' +
    `Buscando en: ${options.cwd}\n` +
    `Entorno: ${describeEnvironment()}`
  );
}

/**
 * El texto del ciclo: como va la cadena ahora mismo.
 *
 * Es la unica forma de mirar la cadena sin abrir un fichero a mano. La arma
 * el mismo modulo puro que la lleva dentro del objetivo encadenado, de modo
 * que lo que ve el agente, lo que ve quien abre el recurso y lo que viaja en
 * el objetivo nuevo son una sola verdad y no tres.
 */
export async function cycleTextOf(options: MissionToolsOptions): Promise<string> {
  const mission = locateMission(options.cwd);
  if (!mission) return withoutMissionText(options);

  const journal = new FileJournal(mission.config.missionId);
  const state = (await journal.load()) ?? freshJournal(toMission(mission.config));
  const completed = completedWork(mission.configPath, state);

  const composed = new ComposedCandidatePort(
    buildCandidatePorts(mission.configPath, mission.workspace, {
      completedObjectives: completed,
    }),
  );
  const available = await composed.discover(state.mission, null);

  const pending: CycleWorkItem[] = available.map((candidate) => ({
    objective: candidate.objective,
    evidence: candidate.evidenceRefs,
    origin: originOf(candidate.source),
  }));

  return renderCycleView(cycleViewOf(state, { completed, pending }));
}

/** Herramientas de la misión, listas para el protocolo. */
export function buildMissionTools(options: MissionToolsOptions): McpTool[] {
  const locate = (): LocatedMission | null => locateMission(options.cwd);
  const now = options.now ?? (() => Date.now());

  const withoutMission = (): string => withoutMissionText(options);

  return [
    {
      name: 'mission_declare',
      description:
        'Declara la misión de este proyecto: escribe el fichero de declaración ' +
        'con su identificador y su objetivo, y deja preparado el directorio de ' +
        'trabajo. Si ya hay una declaración no la toca y devuelve la que hay. ' +
        'Es el primer paso para que la cadena de objetivos arranque en esta sesión.',
      inputSchema: {
        type: 'object',
        properties: {
          objective: { type: 'string', description: 'Qué se quiere conseguir con la misión.' },
          missionId: {
            type: 'string',
            description:
              'Identificador de la misión. Si no se dice, se deriva del nombre y ' +
              'la ruta del proyecto para que dos proyectos no compartan estado.',
          },
          driver: {
            type: 'string',
            enum: ['supervisor', 'plugin'],
            description: 'Qué camino conduce la misión. Por defecto, el que encadena desde la sesión.',
          },
        },
        required: ['objective'],
      },
      async run(args): Promise<string> {
        const objective = String(args.objective ?? '').trim();
        if (!objective) {
          return (
            'Falta el objetivo de la misión. Sin objetivo no hay forma de saber ' +
            'qué trabajo encadenar.'
          );
        }

        const driver = args.driver === 'supervisor' ? 'supervisor' : undefined;
        const declared = declareMission(options.cwd, {
          objective,
          ...(typeof args.missionId === 'string' && args.missionId.trim() !== ''
            ? { missionId: args.missionId.trim() }
            : {}),
          ...(driver ? { driver } : {}),
        });

        const workdir = ensureWorkdir(options.cwd);

        const lines = [
          declared.created
            ? `Misión declarada: ${declared.missionId}`
            : `Ya había una misión declarada: ${declared.missionId} (no se ha tocado)`,
          `Objetivo: ${declared.objective}`,
          `Declaración: ${declared.path}`,
          `Directorio de trabajo: ${workdir.path}`,
          `Conduce: ${declared.driver}`,
        ];
        lines.push(
          declared.created
            ? 'La cadena de objetivos arrancará en el próximo cierre de turno.'
            : 'La cadena de objetivos sigue como estaba.',
        );
        return lines.join('\n');
      },
    },
    {
      name: 'mission_status',
      description:
        'Estado de la misión: en qué está, cuántos objetivos ha encadenado, ' +
        'cuánto ha gastado y qué trabajo hay disponible ahora mismo.',
      inputSchema: { type: 'object', properties: {} },
      async run(): Promise<string> {
        const mission = locate();
        if (!mission) return withoutMission();

        const journal = new FileJournal(mission.config.missionId);
        const state = await journal.load();

        const completed = completedWork(mission.configPath, state);

        const composed = new ComposedCandidatePort(
          buildCandidatePorts(mission.configPath, mission.workspace, {
            completedObjectives: completed,
          }),
        );
        const available = await composed.discover(state?.mission ?? toMission(mission.config), null);

        const lines = state
          ? [
              `Misión: ${state.mission.missionId} — ${state.mission.objective}`,
              `Estado: ${state.mission.status}${state.mission.reason ? ` (${state.mission.reason})` : ''}`,
              `Conduce: ${driverLine(state.mission.driver ?? null)}`,
              `Cadena: ${whyNotChained(cycleViewOf(state, { completed }))}`,
              `Objetivos encadenados: ${state.intents.filter((i) => i.status === 'committed').length}`,
            ]
          : [
              `Misión: ${mission.config.missionId} — ${mission.config.objective}`,
              'Estado: declarada, todavía sin empezar. La cadena arranca sola en el primer cierre de turno.',
              'Conduce: nadie todavia: los dos caminos estan esperando',
              'Cadena: la mision esta declarada pero la cadena todavia no ha arrancado',
            ];

        const verdicts = reviewProposals(mission.config.missionId, mission.workspace, completed);
        const usable = verdicts.filter((verdict) => verdict.defect === null);
        const discarded = verdicts.filter((verdict) => verdict.defect !== null);
        lines.push(`Objetivos ya ejecutados: ${completed.size}`);
        lines.push(`Propuestas utilizables: ${usable.length}`);
        for (const verdict of discarded) {
          lines.push(`- descartada: ${verdict.proposal.objective} (${verdict.defect})`);
        }

        if (available.length === 0) {
          lines.push('Trabajo disponible: ninguno todavía.');
        } else {
          lines.push('Trabajo disponible:');
          for (const candidate of available.slice(0, 10)) {
            const evidence = candidate.evidenceRefs.join(', ');
            lines.push(`- ${candidate.objective}${evidence ? ` (evidencia: ${evidence})` : ''}`);
          }
        }
        return lines.join('\n');
      },
    },
    {
      name: 'mission_cycle',
      description:
        'La vista del ciclo activo, en texto: que quiere la mision, que objetivo va ' +
        'ahora y con que evidencia, que objetivos estan hechos y con que estado, que ' +
        'trabajo queda, cuanto presupuesto se ha gastado y que camino conduce la ' +
        'mision. Es lo que hay que reflejar en la lista de tareas, para que el ' +
        'progreso se vea sin que nadie tenga que pedirlo.',
      inputSchema: { type: 'object', properties: {} },
      async run(): Promise<string> {
        return await cycleTextOf(options);
      },
    },
    {
      name: 'mission_propose',
      description:
        'Propón el siguiente objetivo de la misión. La evidencia tiene que ' +
        'señalar a un fichero que exista en el repositorio y hace falta decir ' +
        'cómo se sabrá que está hecho; sin eso la propuesta se descarta.',
      inputSchema: {
        type: 'object',
        properties: {
          objective: { type: 'string', description: 'Qué hay que hacer, en una frase.' },
          evidence: {
            type: 'string',
            description: 'Fichero del repositorio que respalda la propuesta.',
          },
          whyNow: { type: 'string', description: 'Por qué este trabajo es el siguiente.' },
          doneWhen: {
            type: 'array',
            items: { type: 'string' },
            description: 'Cómo se sabe que está hecho. Al menos un criterio.',
          },
        },
        required: ['objective', 'evidence', 'doneWhen'],
      },
      async run(args): Promise<string> {
        const mission = locate();
        if (!mission) return withoutMission();

        const objective = String(args.objective ?? '').trim();
        const evidence = String(args.evidence ?? '').trim();
        if (!objective) return 'Falta el objetivo de la propuesta.';
        if (!evidence) return 'Falta la evidencia de la propuesta.';

        const doneWhen = Array.isArray(args.doneWhen)
          ? args.doneWhen.map((entry) => String(entry).trim()).filter((entry) => entry.length > 0)
          : [];
        if (doneWhen.length === 0) {
          return (
            'Falta el criterio de cierre de la propuesta: sin al menos un criterio ' +
            'observable no se puede comprobar que el trabajo esté hecho, y la ' +
            'propuesta se descartaría. Indica en `doneWhen` cómo se sabrá.'
          );
        }

        const evidenceRefs = [evidence];
        if (!evidenceExists(mission.workspace, evidenceRefs)) {
          return (
            `La evidencia "${evidence}" no señala a ningún fichero del workspace. ` +
            'Una propuesta sin fichero real no es trabajo.'
          );
        }

        const journal = new FileJournal(mission.config.missionId);
        const state = await journal.load();
        const completed = completedWork(mission.configPath, state);
        if (isCompleted(completed, objective)) {
          return (
            'Ese trabajo ya está ejecutado, así que no se registra como propuesta: ' +
            'una propuesta es trabajo futuro y repetir lo ya pagado pierde el ciclo. ' +
            `Ya ejecutados: ${completed.size}.`
          );
        }

        const candidateId = `propuesta:${objective}`.slice(0, 120);
        writeProposal(mission.config.missionId, {
          candidateId,
          objective,
          whyNow: String(args.whyNow ?? '').trim() || 'Propuesta surgida durante la sesión',
          evidenceRefs,
          doneWhen,
          createdAt: new Date(now()).toISOString(),
        });

        const usable = proposalsToCandidates(mission.config.missionId, mission.workspace);
        return (
          `Propuesta registrada: ${objective}\n` +
          `Evidencia: ${evidence}\n` +
          `Propuestas utilizables: ${usable.length}\n` +
          'Se encadenará en el próximo cierre de turno.'
        );
      },
    },
    {
      name: 'mission_pause',
      description: 'Pausa la cadena de objetivos y el objetivo en curso.',
      inputSchema: { type: 'object', properties: {} },
      async run(): Promise<string> {
        return await order('paused_by_user', locate, 'pausada');
      },
    },
    {
      name: 'mission_resume',
      description:
        'Reanuda una misión pausada o dormida. Devuelve a la cadena el objetivo vivo que habia quedado en pausa, ' +
        'que es la salida cuando el runtime rechaza cerrar por que el objetivo esta pausado.',
      inputSchema: { type: 'object', properties: {} },
      async run(): Promise<string> {
        return await order('running', locate, 'reanudada');
      },
    },
    {
      name: 'mission_stop',
      description: 'Termina la cadena de objetivos de la misión.',
      inputSchema: { type: 'object', properties: {} },
      async run(): Promise<string> {
        return await order('stopped_by_user', locate, 'detenida');
      },
    },
  ];

  async function order(
    status: 'paused_by_user' | 'running' | 'stopped_by_user',
    resolve: () => LocatedMission | null,
    label: string,
  ): Promise<string> {
    const mission = resolve();
    if (!mission) return withoutMission();
    await new FileControlPort(mission.config.missionId).write(status, 'ordenado desde la sesion');
    return `Misión ${label}.`;
  }
}

/**
 * Los recursos de la mision: lo que se puede abrir y leer sin actuar.
 *
 * La vista del ciclo tambien es un recurso porque hay dos maneras legitimas de
 * quererla: invocarla como herramienta cuando el agente decide mirar, o abrirla
 * como recurso cuando el host la ofrece para inspeccion. Las dos devuelven el
 * mismo texto, y por eso salen del mismo sitio.
 */
export function buildMissionResources(options: MissionToolsOptions): McpResource[] {
  return [
    {
      uri: 'goal-compass://ciclo',
      name: 'Ciclo activo',
      description:
        'Como va la mision ahora mismo: objetivo, objetivo en curso con su ' +
        'evidencia, objetivos hechos y pendientes, presupuesto gastado y camino ' +
        'que conduce la cadena.',
      mimeType: 'text/plain',
      read: async () => await cycleTextOf(options),
    },
  ];
}

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: unknown;
}

/**
 * Atiende un mensaje del protocolo y devuelve la respuesta, si la hay.
 *
 * Las notificaciones no se responden: devuelven `null`.
 */
export async function handleMessage(
  message: JsonRpcMessage,
  tools: McpTool[],
  resources: McpResource[] = [],
): Promise<unknown | null> {
  const { id, method, params } = message;
  if (method === undefined) return null;

  switch (method) {
    case 'initialize': {
      const requested = params?.protocolVersion;
      return {
        protocolVersion: typeof requested === 'string' ? requested : PROTOCOL_VERSION,
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: 'goal-compass', version: '1' },
      };
    }
    case 'ping':
      return {};
    case 'tools/list':
      return {
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      };
    case 'resources/list':
      return {
        resources: resources.map((resource) => ({
          uri: resource.uri,
          name: resource.name,
          description: resource.description,
          mimeType: resource.mimeType,
        })),
      };
    case 'resources/read': {
      const uri = String(params?.uri ?? '');
      const resource = resources.find((candidate) => candidate.uri === uri);
      if (!resource) {
        return {
          contents: [{ uri, mimeType: 'text/plain', text: `No existe el recurso "${uri}".` }],
          isError: true,
        };
      }
      try {
        const text = await resource.read();
        return { contents: [{ uri: resource.uri, mimeType: resource.mimeType, text }] };
      } catch (err) {
        return {
          contents: [
            {
              uri: resource.uri,
              mimeType: 'text/plain',
              text: `El recurso "${uri}" falló: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    }
    case 'tools/call': {
      const name = String(params?.name ?? '');
      const tool = tools.find((candidate) => candidate.name === name);
      if (!tool) {
        return { content: [{ type: 'text', text: `No existe la herramienta "${name}".` }], isError: true };
      }
      const args = (params?.arguments ?? {}) as Record<string, unknown>;
      try {
        const text = await tool.run(args);
        return { content: [{ type: 'text', text }] };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `La herramienta "${name}" falló: ${(err as Error).message}` }],
          isError: true,
        };
      }
    }
    default:
      if (id === undefined) return null;
      return undefined;
  }
}

/** Arranca el servidor sobre la entrada y salida estándar. */
export async function serve(options: MissionToolsOptions): Promise<void> {
  const tools = buildMissionTools(options);
  const resources = buildMissionResources(options);
  const input = createInterface({ input: process.stdin });

  input.on('line', (line) => {
    if (!line.trim()) return;
    void (async () => {
      let message: JsonRpcMessage;
      try {
        message = JSON.parse(line) as JsonRpcMessage;
      } catch {
        return;
      }
      const result = await handleMessage(message, tools, resources);
      if (result === null || result === undefined) return;
      if (message.id === undefined || message.id === null) return;
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n`);
    })();
  });
}


/**
 * Variables de entorno que pueden decir donde esta el proyecto.
 *
 * El host lanza el servidor desde su propia carpeta, asi que el servidor
 * necesita una pista para encontrar la mision. Se listan las que existen
 * para que el diagnostico diga que se puede usar.
 */
export function describeEnvironment(env: NodeJS.ProcessEnv = process.env): string {
  const candidates = [
    'MINIMAX_PROJECT_DIR',
    'CLAUDE_PROJECT_DIR',
    'CODEX_PROJECT_DIR',
    'MCP_PROJECT_DIR',
    'WORKSPACE',
    'WORKSPACE_DIR',
    'PWD',
    'PLUGIN_ROOT',
    'PLUGIN_DATA',
  ];
  const present = candidates
    .filter((name) => typeof env[name] === 'string' && env[name]?.trim())
    .map((name) => `${name}=${env[name]}`);
  return present.length > 0 ? present.join(' ') : '(ninguna de las conocidas)';
}

/**
 * Directorio desde el que se busca la declaracion de la mision.
 *
 * El host lanza el servidor desde su propia carpeta, asi que el directorio
 * de trabajo del proceso no dice nada del proyecto. Lo que si lo dice es el
 * entorno: el host publica el directorio del proyecto en una variable
 * explicita o, en su defecto, en `PWD`.
 */
export function resolveWorkspaceDir(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = [
    env.MINIMAX_PROJECT_DIR,
    env.CLAUDE_PROJECT_DIR,
    env.CODEX_PROJECT_DIR,
    env.MCP_PROJECT_DIR,
  ].find((value) => typeof value === 'string' && value.trim());
  if (explicit) return explicit.trim();

  const fromShell = env.PWD;
  if (fromShell && fromShell.trim() && existsSync(fromShell.trim())) return fromShell.trim();

  return process.cwd();
}

/** Registro que escribe en la salida de error: la salida normal es del protocolo. */
const logger: Logger = {
  info: (message) => process.stderr.write(`[goal-compass] ${message}\n`),
  warn: (message) => process.stderr.write(`[goal-compass] AVISO ${message}\n`),
  error: (message) => process.stderr.write(`[goal-compass] ERROR ${message}\n`),
};

/**
 * Indica si este fichero es el punto de entrada.
 *
 * Se comparan las rutas reales y no las escritas: el host puede invocar el
 * programa por un camino con enlaces simbolicos, y entonces las dos rutas
 * distintas parecen dos ficheros que no son el mismo.
 */
function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  serve({ cwd: resolveWorkspaceDir(), logger }).catch((err) => {
    logger.error(String(err));
    process.exitCode = 1;
  });
}
