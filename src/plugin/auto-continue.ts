/**
 * Continuacion de la mision cuando el agente cierra su turno.
 *
 * Es el corazon del plugin: cuando el objetivo en curso termina, este modulo
 * encadena el siguiente en la misma sesion en la que esta trabajando el
 * agente. No hay un proceso de fondo esperando: el propio cierre de turno
 * del agente es el latido de la mision.
 *
 * Reglas que no se saltan:
 *  - Solo `complete` habilita encadenar. Un objetivo activo, pausado o
 *    bloqueado se deja como esta.
 *  - Si algo falla, el turno continua igual. Un plugin nunca deja al
 *    usuario sin respuesta por un problema propio.
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AcpGoalAdapter } from '../adapters/acp-goal.js';
import { openMission } from '../runtime.js';
import { locateMission } from './mission-locator.js';
import type { Logger } from '../ports.js';
import type { Journal, TransitionIntent } from '../core/types.js';

/**
 * Margen que el hook se da a si mismo.
 *
 * El host corta el hook pasado su tiempo, y un corte a media faena deja a
 * medias una sesion del host. Es mejor pararse antes y dejar la mision como
 * estaba: el siguiente turno lo intentara de nuevo.
 *
 * El host da a un hook de plugin diez segundos como maximo, y el manifiesto
 * no puede pedir mas. El margen tiene que estar por encima del trabajo real
 * —arrancar el host, reanudar la sesion y crear el objetivo lleva unos
 * segundos— y por debajo de ese limite. Si el hook se pasa, el host lo tira
 * y el turno se queda sin continuacion: peor que no encadenar nada.
 */
const DEADLINE_MS = 9_500;

export interface HookEvent {
  hook_event_name?: string;
  session_id?: string;
  cwd?: string;
  payload?: {
    stop_hook_active?: boolean;
    last_assistant_message?: string;
  };
}

/** Registro que escribe en la salida de error: la salida normal es del hook. */
const logger = {
  info: (message: string) => process.stderr.write(`[goal-compass] ${message}\n`),
  warn: (message: string) => process.stderr.write(`[goal-compass] AVISO ${message}\n`),
  error: (message: string) => process.stderr.write(`[goal-compass] ERROR ${message}\n`),
};

/** Interpreta el evento que el host entrega por la entrada estandar. */
export function parseHookEvent(raw: string): HookEvent | null {
  if (!raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as HookEvent;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** Opciones del disparo de continuacion. */
export interface AutoContinueOptions {
  /** Margen de tiempo del hook. */
  deadlineMs?: number;
  /** Milisegundos que una peticion al host puede esperar. */
  requestTimeoutMs?: number;
  /** Ejecutable del host, cuando no es el de por defecto. */
  host?: { command?: string; args?: string[] };
  /** Donde se cuenta lo que va pasando. */
  logger?: Logger;
}

/**
 * Encadena el siguiente objetivo si toca, y devuelve lo que el host debe
 * hacer con el turno. Una cadena vacia significa "no hay nada que decir".
 */
export async function runAutoContinue(
  raw: string,
  options: AutoContinueOptions = {},
): Promise<string> {
  const deadlineMs = options.deadlineMs ?? DEADLINE_MS;
  const log = options.logger ?? logger;
  const event = parseHookEvent(raw);
  if (!event) return '';

  const sessionId = event.session_id;
  const cwd = event.cwd;
  if (!sessionId || !cwd) return '';

  const mission = locateMission(cwd);
  if (!mission) return '';

  let runtime: Awaited<ReturnType<typeof openMission>> | undefined;
  let adapter: AcpGoalAdapter | undefined;
  let finished = false;

  const work = (async (): Promise<string> => {
    try {
      // El adaptador se construye aqui para poderlo cerrar aunque la mision no
      // llegue a arrancarse: el host es un proceso, y un proceso sin cerrar
      // deja al hook sin terminar nunca.
      adapter = new AcpGoalAdapter({
        workspace: mission.config.workspace,
        sessionId,
        logger: log,
        ...(options.host?.command !== undefined ? { command: options.host.command } : {}),
        ...(options.host?.args !== undefined ? { args: options.host.args } : {}),
        ...(options.requestTimeoutMs !== undefined
          ? { requestTimeoutMs: options.requestTimeoutMs }
          : {}),
      });

      runtime = await openMission({
        config: mission.config,
        configPath: mission.configPath,
        logger: log,
        sessionId,
        driver: 'plugin',
        adapter,
        // Preguntar al modelo por trabajo consume tiempo y el turno tiene un
        // limite: la exploracion la hace el agente, no el hook.
        exploration: false,
      });

      if (!runtime.driving) {
        log.info(`el hook no encadena nada: ${runtime.reason ?? 'la mision la conduce otro camino'}`);
        return '';
      }

      const outcome = await runtime.supervisor.step();
      if (!outcome.created) return '';

      log.info(`objetivo encadenado: ${outcome.created.goalId}`);
      const state = await runtime.journal.load();
      // La intencion del objetivo recien creado es la que sabe de donde sale
      // el trabajo y como se demuestra.
      const intent = state?.intents.find(
        (entry) => entry.goalId === outcome.created?.goalId,
      );
      return JSON.stringify({
        decision: 'block',
        reason: continuePrompt(
          intent?.objective ?? outcome.created.objective,
          mission.config.allowRemoteWrite,
          state,
          intent,
          outcome.decision.kind === 'retry',
        ),
      });
    } catch (err) {
      log.warn(`no se pudo encadenar el objetivo siguiente: ${(err as Error).message}`);
      return '';
    } finally {
      finished = true;
      await adapter?.close().catch(() => {});
    }
  })();

  const guard = new Promise<string>((resolve) => {
    setTimeout(() => {
      if (finished) return;
      log.warn('el hook se queda sin tiempo: la mision sigue como estaba');
      // El host se cierra aqui: si no, el hook no termina, el host espera su
      // propio limite y tira lo que hemos preparado.
      void adapter?.close().catch(() => {});
      resolve('');
    }, deadlineMs).unref();
  });

  return Promise.race([work, guard]);
}

/**
 * Lo que el agente recibe para seguir trabajando.
 *
 * El limite de publicacion de la mision viaja aqui porque el agente es el
 * unico que puede hacer push, publicar o desplegar: si la mision no lo
 * autoriza, el agente tiene que saberlo antes de empezar.
 *
 * Y con el limite viaja el contexto, porque un objetivo sin contexto obliga a
 * rededucir el estado del proyecto en cada turno. La respuesta de continuacion
 * dice donde esta la mision ahora mismo: cuanto ha hecho, cuanto le queda y
 * que se esta trabajando.
 *
 * Con el contexto viaja la evidencia y el criterio de cierre del objetivo
 * que se encadena. Sin ellos, el agente tiene que volver a buscar de donde
 * sale el trabajo, y el criterio —que es lo que decide si el objetivo esta
 * demostrado— no le llega a quien tiene que demostrarlo.
 *
 * La ultima parte es la que cierra el bucle: al terminar, el agente deja el
 * trabajo siguiente propuesto. Sin eso, la cadena se queda sin fuel en cuanto
 * la cola se vacia, aunque la mision siga viva.
 */
function continuePrompt(
  objective: string,
  allowRemoteWrite: boolean,
  state: Journal | null,
  intent?: TransitionIntent,
  retried = false,
): string {
  const boundary = allowRemoteWrite
    ? 'La mision autoriza publicar, pero hace falta autorizacion explicita del usuario.'
    : 'La mision no autoriza publicar: no hagas push, ni tag, ni release, ni despliegue.';
  const origin = retried
    ? 'La mision continua: el objetivo se quedo sin presupuesto y este es el mismo trabajo reintentado con mas margen.\n'
    : 'La mision continua: el objetivo siguiente ya esta creado y activo.\n';
  return (
    `${origin}` +
    `Objetivo: ${objective}\n\n` +
    `${evidenceOf(intent)}\n` +
    `${contextOf(state)}\n` +
    `Trabaja ese objetivo con la skill goal-compass: empieza por el nodo de ` +
    `entrada del arbol, elige solo el nodo que corresponda y ejecuta una accion ` +
    `pequena y verificable. Cuando su alcance este probado, cierralo con ` +
    `update_goal(status=complete).\n\n` +
    `Cuando termines, deja el trabajo siguiente: con mission_propose, la evidencia ` +
    `que lo respalda y como se sabra que esta hecho. Si de verdad no hay trabajo ` +
    `que quede, dilo con claridad en vez de inventarlo. La cadena sigue mientras ` +
    `alguien deje trabajo.\n\n` +
    `Limite de la mision: ${boundary}`
  );
}

/**
 * De donde sale el trabajo que se encadena y como se sabra que esta hecho.
 *
 * Son dos datos que el backlog ya tenia y que se perdian antes de llegar al
 * agente. Aqui vuelven a estar, en el mismo sitio donde el agente lee que
 * tiene que trabajar.
 */
function evidenceOf(intent: TransitionIntent | undefined): string {
  const evidence = intent?.evidenceRefs ?? [];
  const doneWhen = intent?.doneWhen ?? [];
  if (evidence.length === 0 && doneWhen.length === 0) return '';

  const lines: string[] = [];
  if (evidence.length > 0) lines.push(`Evidencia: ${evidence.join(', ')}`);
  if (doneWhen.length > 0) {
    lines.push('Criterio de cierre:');
    for (const item of doneWhen) lines.push(`- ${item}`);
  }
  return `${lines.join('\n')}\n\n`;
}

/**
 * El estado de la mision en el momento de la continuacion.
 *
 * Es lo que el agente necesita para no empezar a ciegas: que se ha hecho, que
 * queda y por que la mision esta como esta.
 */
function contextOf(state: Journal | null): string {
  if (!state) return 'Contexto: la mision todavia no tiene historial.';

  const completed = state.goals.filter((goal) => goal.status === 'complete');
  const metrics = state.metrics;
  const tokens =
    metrics?.tokensUsed ?? state.goals.reduce((total, goal) => total + goal.tokensUsed, 0);
  const budget = state.mission.totalTokenBudget;
  const last = completed[completed.length - 1];
  const chained =
    metrics?.goalsCreated ?? state.intents.filter((intent) => intent.status === 'committed').length;
  const exhaustions = metrics?.budgetExhaustions ?? state.budgetAttempts?.length ?? 0;

  const lines = [
    `Contexto de la mision "${state.mission.missionId}":`,
    `- estado: ${state.mission.status}${state.mission.reason ? ` (${state.mission.reason})` : ''}`,
    `- objetivos completados: ${completed.length}` +
      (last ? `; el ultimo fue "${last.objective}"` : ''),
    `- objetivos encadenados: ${chained}`,
    `- presupuesto: ${tokens} token(s)${budget !== null ? ` de ${budget}` : ''}` +
      (metrics?.budgetExceeded ? ' (superado: la cadena sigue, el presupuesto es una medida)' : ''),
    `- trabajo declarado pendiente: ${state.mission.backlog.length} candidato(s)`,
  ];

  if (exhaustions > 0) {
    lines.push(`- intentos que se quedaron sin presupuesto: ${exhaustions}`);
  }

  return lines.join('\n');
}

/**
 * Indica si este fichero es el punto de entrada.
 *
 * Se comparan las rutas reales y no las escritas: el host puede invocar el
 * hook por un camino con enlaces simbolicos, y entonces las dos rutas
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

/**
 * Un numero del entorno, si lo hay.
 *
 * Sirve para acortar las esperas cuando hay que depurar: no cambia el
 * comportamiento normal.
 */
function readNumber(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw || !raw.trim()) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/** Punto de entrada: el host ejecuta este fichero y lee su salida. */
async function main(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8');
  const output = await runAutoContinue(raw, {
    ...readNumber('GOAL_COMPASS_REQUEST_TIMEOUT_MS')
      ? { requestTimeoutMs: readNumber('GOAL_COMPASS_REQUEST_TIMEOUT_MS')! }
      : {},
  });
  if (output) {
    // La salida se escribe antes de salir: si el proceso se va a mitad, el
    // host se queda sin la continuacion que prepared.
    await new Promise<void>((resolve) => process.stdout.write(`${output}\n`, () => resolve()));
  }
  // El hook termina aqui, siempre. Un hook que no termina hace que el host
  // espere a su propio limite y tire lo que este proceso iba a dizer.
  process.exit(0);
}

if (isEntryPoint()) {
  main().catch((err) => {
    logger.error(String(err));
    process.exitCode = 0;
  });
}
