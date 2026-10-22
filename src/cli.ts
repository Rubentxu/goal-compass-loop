#!/usr/bin/env node
/**
 * Interfaz de linea de comandos del supervisor de Goals.
 *
 * Los comandos son operaciones sobre una mision: preparar su estado durable,
 * arrancar el bucle, consultar el estado y ordenar al supervisor que pare,
 * pause o continue. La orden del usuario viaja por un canal de control
 * separado del journal, de modo que nunca se pisa el estado de ejecucion.
 */
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { spawn, spawnSync } from 'node:child_process';
import { AcpGoalAdapter } from './adapters/acp-goal.js';
import { FileControlPort } from './adapters/control.js';
import { FileJournal, journalPath, stateRoot } from './adapters/journal.js';
import { declareMission, loadMissionConfig } from './adapters/mission.js';
import { auditDeclaration } from './adapters/declaration-audit.js';
import { openMission, ensureMissionState } from './runtime.js';
import { loadTree, validateTree } from './adapters/tree.js';
import { ensureWorkdir, treeDirFor } from './adapters/workdir.js';
import { findMissionFile } from './plugin/mission-locator.js';
import { nudgePromptPath, readNudgePrompt } from './plugin/nudge-prompt.js';
import { releaseWatchLock, takeWatchLock } from './plugin/watch-lock.js';
import {
  defaultMarketplaceDir,
  installPlugin,
  PLUGIN_NAME,
  projectRootFromModule,
} from './plugin/install.js';
import { selectCandidates } from './core/decide.js';
import { normalizeJournal, type Candidate, type Journal, type MissionStatus } from './core/types.js';
import { DEFAULT_NUDGE_COOLDOWN_MS, DEFAULT_NUDGE_STALL_MS, decideNudge } from './core/nudge.js';
import { classifyPush, cuentaComoEmpuje } from './core/push.js';

const logger = {
  info: (message: string) => console.log(`[${new Date().toISOString()}] ${message}`),
  warn: (message: string) => console.warn(`[${new Date().toISOString()}] AVISO ${message}`),
  error: (message: string) => console.error(`[${new Date().toISOString()}] ERROR ${message}`),
};

type Options = Record<string, unknown>;

/** Objetivo que se declara cuando el usuario no dice cual quiere. */
const DEFAULT_OBJECTIVE = 'Mejorar este proyecto paso a paso, con evidencia en cada paso';

const USAGE = `Goal Compass Loop · supervisor de Goals nativos

  goal-compass declare --workspace <dir>            declara la mision de un proyecto
  goal-compass init   --config <mission.json>     prepara el estado durable de la mision
  goal-compass run    --config <mission.json>     arranca el bucle supervisor
  goal-compass status --mission <mission-id>      muestra el estado de la mision
  goal-compass nudge --mission <mission-id>        empuja la sesion si la cadena se quedo quieta
  goal-compass watch [--mission <id>] [--all] --every 10m  repite el empujon cada cierto rato
  goal-compass pause|resume|stop --mission <id>   ordenes del usuario
  goal-compass probe  --workspace <dir>           comprueba la extension ACP del host
  goal-compass tree   --workspace <dir>           prepara el arbol del proyecto y lo valida
  goal-compass doctor --workspace <dir>           audita una declaracion de mision
  goal-compass doctor                            audita todas las misiones declaradas
  goal-compass install-skill                       instala la skill goal-compass
  goal-compass install-plugin                      ensambla el plugin de MCode

  declare admite ademas: --mission-id <id> --objective <texto> --driver supervisor|plugin
                         --budget <tokens> --total-budget <tokens> --allow-remote-write
`;

function parse(argv: string[]): { values: Options; positionals: string[] } {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      config: { type: 'string' },
      mission: { type: 'string' },
      'mission-id': { type: 'string' },
      workspace: { type: 'string' },
      objective: { type: 'string' },
      driver: { type: 'string' },
      budget: { type: 'string' },
      'total-budget': { type: 'string' },
      'allow-remote-write': { type: 'boolean' },
      'poll-ms': { type: 'string' },
      every: { type: 'string' },
      prompt: { type: 'string' },
      'dry-run': { type: 'boolean' },
      quiet: { type: 'boolean' },
      all: { type: 'boolean' },
      'max-iterations': { type: 'string' },
      help: { type: 'boolean' },
    },
  });
  return { values: values as Options, positionals };
}

function requireString(values: Options, name: string, hint: string): string {
  const value = values[name];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`falta ${hint}`);
  }
  return value;
}

function requireMissionId(values: Options): string {
  return requireString(values, 'mission', '--mission <mission-id>');
}

function optionalNumber(values: Options, name: string): number | undefined {
  const raw = values[name];
  if (typeof raw !== 'string') return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

// ------------------------------------------------------------------ comandos

/**
 * Diagnostico de las misiones declaradas.
 *
 * Solo lee. No escribe en ningun proyecto, ni en el suyo: un diagnostico que
 * arregla por el camino no se puede usar para preguntar como estan las cosas.
 *
 * Sin argumentos, audita todas las misiones que el estado durable conoce, que
 * es como se ve la flota: que mision puede encadenar y cual no, y por que.
 */
async function cmdDoctor(values: Options): Promise<void> {
  const workspaces = workspacesToAudit(values);
  if (workspaces.length === 0) {
    console.log('no hay ninguna mision declarada que diagnosticar');
    return;
  }

  let conProblemas = 0;
  for (const { missionId, workspace } of workspaces) {
    const path = findMissionFile(workspace);
    if (!path) {
      console.log(`${missionId.padEnd(28)} ${workspace}`);
      console.log('  sin declaracion: no hay ningun goal-compass.json que leer');
      conProblemas += 1;
      continue;
    }

    let audit;
    try {
      audit = auditDeclaration(path, { workspace });
    } catch (err) {
      console.log(`${missionId.padEnd(28)} ${workspace}`);
      console.log(`  la declaracion no se puede leer: ${(err as Error).message}`);
      conProblemas += 1;
      continue;
    }

    const estado = audit.problems.length === 0 ? 'lista' : 'con problemas';
    console.log(
      `${missionId.padEnd(28)} ${workspace}\n` +
        `  candidatos: ${audit.candidates} | usables: ${audit.ready} | descartados: ${audit.discarded} | ${estado}`,
    );

    // Agrupado por tipo: veinte candidatos con el mismo defecto son una
    // linea, no veinte.
    for (const [kind, grupo] of groupBy(audit.problems, (p) => p.kind)) {
      const donde = grupo[0]!.candidateId;
      const lista =
        grupo.length === 1
          ? `((${donde}))`
          : `(${grupo.length}: ${grupo
              .map((p) => p.candidateId)
              .filter((id): id is string => typeof id === 'string')
              .slice(0, 8)
              .join(', ')}${grupo.length > 8 ? ', ...' : ''})`;
      console.log(`  - [${kind}] ${lista} ${grupo[0]!.detail}`);
      if (grupo[0]!.hint) console.log(`      ${grupo[0]!.hint}`);
    }
    if (audit.ignoredFields.length > 0) {
      console.log(
        `  campos que el cargador no lee y no son problema: ${audit.ignoredFields.join(', ')}`,
      );
    }
    if (audit.problems.length > 0) conProblemas += 1;
  }

  if (conProblemas > 0) {
    console.log('');
    console.log(`${conProblemas} de ${workspaces.length} mision(es) con problemas.`);
  }
}

/**
 * Agrupa por una clave, conservando el orden en que aparecen.
 */
function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const grupos = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const grupo = grupos.get(k);
    if (grupo) grupo.push(item);
    else grupos.set(k, [item]);
  }
  return grupos;
}

/**
 * Las misiones a auditar.
 *
 * Con `--workspace` se audita esa; con `--mission`, la que diga el estado
 * durable; sin nada, todas las que el estado durable conoce.
 */
function workspacesToAudit(values: Options): { missionId: string; workspace: string }[] {
  const workspace = typeof values.workspace === 'string' ? values.workspace : undefined;
  if (workspace) {
    const resolved = resolve(workspace);
    return [{ missionId: basename(resolved), workspace: resolved }];
  }

  const root = stateRoot();
  if (!existsSync(root)) return [];

  const missions: { missionId: string; workspace: string }[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const journal = join(root, entry.name, 'journal.json');
    if (!existsSync(journal)) continue;
    try {
      const state = JSON.parse(readFileSync(journal, 'utf8')) as {
        missionId?: string;
        mission?: { workspace?: string };
      };
      const missionWorkspace = state.mission?.workspace;
      if (!missionWorkspace) continue;
      missions.push({ missionId: state.missionId ?? entry.name, workspace: missionWorkspace });
    } catch {
      // Un journal ilegible no es una mision que auditar: se salta.
    }
  }
  return missions.sort((a, b) => a.missionId.localeCompare(b.missionId));
}

/**
 * Declara la mision de un proyecto.
 *
 * Es la puerta que se abre desde un prompt: deja el proyecto con su
 * declaracion y su directorio de trabajo, y dice que camino la conduce.
 *
 * No pisa una declaracion que ya este. Preparar la mision dos veces no puede
 * perder el trabajo de quien la escribio a mano, y la segunda vez dice que
 * hay ahi en vez de dejar un error incomprensible.
 */
async function cmdDeclare(values: Options): Promise<void> {
  const workspace = resolve(
    typeof values.workspace === 'string' ? values.workspace : process.cwd(),
  );

  const workdir = ensureWorkdir(workspace);
  logger.info(
    `directorio de trabajo: ${workdir.path}` +
      (workdir.created ? ' (creado)' : '') +
      (workdir.gitignoreAdded ? ' (anadido a .gitignore)' : ''),
  );

  const driver =
    values.driver === 'supervisor' || values.driver === 'plugin' ? values.driver : undefined;

  const declared = declareMission(workspace, {
    ...(typeof values['mission-id'] === 'string' ? { missionId: values['mission-id'] } : {}),
    objective:
      typeof values.objective === 'string' && values.objective.trim() !== ''
        ? values.objective
        : DEFAULT_OBJECTIVE,
    ...(driver ? { driver } : {}),
    ...(optionalNumber(values, 'budget') !== undefined
      ? { defaultTokenBudget: optionalNumber(values, 'budget')! }
      : {}),
    ...(optionalNumber(values, 'total-budget') !== undefined
      ? { totalTokenBudget: optionalNumber(values, 'total-budget')! }
      : {}),
    ...(values['allow-remote-write'] === true ? { allowRemoteWrite: true } : {}),
  });

  logger.info(
    declared.created
      ? `mision declarada en ${declared.path}`
      : `ya habia una mision declarada en ${declared.path}: no se toca`,
  );

  // Releer lo escrito es la unica forma de saber que lo que hay en disco se
  // puede leer de verdad y no solo parecer bueno.
  const config = loadMissionConfig(declared.path, { workspace });
  logger.info(`mision: ${config.missionId}`);
  logger.info(`objetivo: ${config.objective}`);
  logger.info(`conduce: ${config.driver ?? 'plugin'}`);
  logger.info(`estado durable: ${journalPath(config.missionId)}`);

  // Declarar no es solo escribir: es decir si lo escrito sirve. Una
  // declaracion con el campo de la evidencia mal escrito se lee entera y no
  // vale para nada, y eso hay que decirlo aqui, no tres semanas despues.
  const audit = auditDeclaration(declared.path, { workspace });
  logger.info(
    `candidatos: ${audit.candidates} | usables: ${audit.ready} | descartados: ${audit.discarded}`,
  );
  for (const problema of audit.problems) {
    const donde = problema.candidateId ? ` (${problema.candidateId})` : '';
    logger.warn(`[${problema.kind}]${donde} ${problema.detail}`);
    if (problema.hint) logger.warn(`  ${problema.hint}`);
  }

  console.log('');
  console.log('abre una sesion en el proyecto y pide: "continua la mision de este repositorio".');
}

async function cmdInit(values: Options): Promise<void> {
  const configPath = requireString(values, 'config', '--config <mission.json>');
  const config = loadMissionConfig(configPath);
  const journal = new FileJournal(config.missionId);

  if (await journal.load()) {
    logger.info(`la mision ya estaba inicializada en ${journal.filePath}`);
    return;
  }

  await ensureMissionState(config, journal, logger);

  logger.info(`estado durable: ${journal.filePath}`);
  logger.info(`workspace: ${config.workspace}`);
  logger.info(`backlog: ${config.backlog.length} candidato(s)`);
}

async function cmdRun(values: Options): Promise<void> {
  const configPath = requireString(values, 'config', '--config <mission.json>');
  const config = loadMissionConfig(configPath);

  const { supervisor, adapter, driving, reason } = await openMission({
    config,
    configPath,
    logger,
    driver: 'supervisor',
    ...(optionalNumber(values, 'poll-ms') !== undefined
      ? { pollIntervalMs: optionalNumber(values, 'poll-ms')! }
      : {}),
    ...(optionalNumber(values, 'max-iterations') !== undefined
      ? { maxIterations: optionalNumber(values, 'max-iterations')! }
      : {}),
  });

  if (!driving) {
    logger.warn(`esta mision no la conduce el supervisor: ${reason ?? 'la conduce otro camino'}`);
    await adapter.close();
    return;
  }

  const shutdown = (): void => {
    logger.info('parada solicitada: cerrando el supervisor');
    supervisor.stop();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  try {
    await supervisor.run();
  } finally {
    await adapter.close();
  }
}

async function cmdStatus(values: Options): Promise<void> {
  const missionId = requireMissionId(values);
  const journal = new FileJournal(missionId);
  const state = await journal.load();
  if (!state) {
    console.log(`mision "${missionId}" no inicializada (${journalPath(missionId)})`);
    return;
  }

  const control = await new FileControlPort(missionId).read();
  const effective = control ?? state.mission.status;
  const committed = state.intents.filter((intent) => intent.status === 'committed');
  const tokensUsed = state.goals.reduce((total, record) => total + record.tokensUsed, 0);

  console.log(`mision:   ${state.missionId}`);
  console.log(`estado:   ${effective}`);
  if (control && control !== state.mission.status) {
    console.log(`          (orden pendiente de aplicar; estado guardado=${state.mission.status})`);
  }
  console.log(`motivo:   ${state.mission.reason ?? '-'}`);
  console.log(`session:  ${state.sessionId ?? '-'}`);
  console.log(`conduce:  ${state.mission.driver ?? 'nadie todavia'}`);
  console.log(`goals:    ${state.goals.length} completado(s), ${committed.length} creado(s)`);
  console.log(`presupuesto: ${tokensUsed} token(s) consumidos`);
  for (const goal of state.goals) {
    console.log(
      `  - ${goal.goalId} ${goal.status} "${goal.objective.slice(0, 60)}" ` +
        `(${goal.tokensUsed} tokens, ${goal.turnsUsed} turnos)`,
    );
  }
  const pending = state.intents.find((intent) => intent.status === 'intent');
  if (pending) {
    console.log(`intencion pendiente: ${pending.candidateId} (${pending.intentId})`);
  }
}

function controlCommand(status: MissionStatus) {
  return async (values: Options): Promise<void> => {
    const missionId = requireMissionId(values);
    await new FileControlPort(missionId).write(status);
    console.log(`mision "${missionId}" -> ${status}`);
  };
}

async function cmdProbe(values: Options): Promise<void> {
  const workspace =
    typeof values.workspace === 'string' ? values.workspace : process.cwd();
  const adapter = new AcpGoalAdapter({ workspace, logger });
  try {
    await adapter.start();
    const goal = await adapter.read(adapter.sessionId());
    logger.info(
      `extension disponible. session=${adapter.sessionId()} goal=${goal ? goal.status : 'sin goal'}`,
    );
  } finally {
    await adapter.close();
  }
}

/**
 * Prepara el arbol de decision de un proyecto y lo cuenta.
 *
 * Deja el directorio de trabajo en su sitio, con su entrada en `.gitignore`, y
 * dice que arbol se esta siguiendo: el del proyecto si tiene el suyo, el de la
 * skill si no. Un arbol con problemas se dice y se cuenta; no se arregla solo.
 */
async function cmdTree(values: Options): Promise<void> {
  const workspace =
    typeof values.workspace === 'string' ? values.workspace : process.cwd();

  const workdir = ensureWorkdir(workspace);
  logger.info(
    `directorio de trabajo: ${workdir.path}` +
      (workdir.created ? ' (creado)' : '') +
      (workdir.gitignoreAdded ? ' (anadido a .gitignore)' : ''),
  );
  logger.info(`ignorado por git: ${workdir.ignored ? 'si' : 'no'}`);

  const fallback = join(resolveSkillSource(), 'graph');
  const { dir, source } = treeDirFor(workspace, fallback);
  logger.info(`arbol: ${dir} (${source === 'proyecto' ? 'del proyecto' : 'de la skill'})`);

  const tree = loadTree(dir);
  const links = [...tree.nodes.values()].reduce((total, node) => total + node.links.length, 0);
  const control = [...tree.nodes.values()].filter((node) => node.role === 'supervisor').length;

  logger.info(`entrada: ${tree.entry}`);
  logger.info(`nodos: ${tree.nodes.size} (${tree.nodes.size - control} de agente, ${control} de control)`);
  logger.info(`enlaces: ${links}`);

  const problems = validateTree(tree);
  if (problems.length > 0) {
    for (const problem of problems) logger.warn(problem);
    throw new Error(`el arbol tiene ${problems.length} problema(s)`);
  }
  logger.info('el arbol no tiene problemas');
}

async function cmdInstallSkill(): Promise<void> {
  const source = resolveSkillSource();
  const dataDir =
    process.env.MINIMAX_DATA_DIR ?? process.env.MAVIS_DATA_DIR ?? join(homedir(), '.minimax');
  const target = join(dataDir, 'skills', 'goal-compass');

  if (!existsSync(source)) throw new Error(`no se encuentra la skill en ${source}`);
  mkdirSync(target, { recursive: true });
  cpSync(source, target, { recursive: true });

  logger.info(`skill instalada en ${target}`);
  logger.info('abre una sesion nueva y comprueba la lista de skills');
}

async function cmdInstallPlugin(values: Options): Promise<void> {
  const projectRoot = resolveProjectRoot();
  const marketplaceDir =
    typeof values.marketplace === 'string' ? values.marketplace : defaultMarketplaceDir();
  const target = await installPlugin({ projectRoot, marketplaceDir, logger });

  console.log(`plugin ensamblado en ${target}`);
  console.log('');
  console.log('registralo en MCode con:');
  console.log(`  mcode plugin add ${PLUGIN_NAME} -m local`);
  console.log('');
  console.log('despues, en el repositorio que quieras encadenar, declara la mision:');
  console.log(
    `  node ${join(marketplaceDir, PLUGIN_NAME, 'dist', 'cli.js')} declare ` +
      '--workspace <dir> --objective "<que busca la mision>"',
  );
  console.log('');
  console.log('despues, pide en la sesion: "continua la mision de este repositorio".');
}

/** Localiza la carpeta de la skill segun como se ejecuto el binario. */
function resolveSkillSource(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '..', 'skill', 'goal-compass'),
    resolve(here, '..', '..', 'skill', 'goal-compass'),
    resolve(process.cwd(), 'skill', 'goal-compass'),
  ];
  return candidates.find((candidate) => existsSync(join(candidate, 'SKILL.md'))) ?? candidates[0]!;
}

/** Localiza la raiz del proyecto segun como se ejecuto el binario. */
function resolveProjectRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    projectRootFromModule(import.meta.url),
    resolve(here, '..', '..'),
    process.cwd(),
  ];
  return candidates.find((candidate) =>
    existsSync(join(candidate, 'plugin', '.minimax-plugin', 'plugin.json')),
  ) ?? candidates[0]!;
}

/** Empuja la sesion si toca. Devuelve lo que paso, para poder contarlo. */
async function empujar(missionId: string, values: Options, _imprimir: boolean): Promise<string> {
  const guardado = await new FileJournal(missionId).load();
  if (!guardado) {
    return `la mision ${missionId} todavia no tiene estado: nada que empujar`;
  }
  // Los journals que llevan tiempo guardados estan en el formato de cuando se
  // escribieron, no en el de ahora. Sin normalizar, un candidato de antes no
  // tiene la lista de prerrequisitos y el vigilante revienta al mirarlo —que
  // es justo lo que hacia, en vez de empujar.
  const state = normalizeJournal(guardado);
  // El backlog declarado es la unica fuente que se puede mirar sin abrir un
  // host, y es la que decide si hay trabajo de verdad delante.
  const candidates: Candidate[] = state.mission.backlog;
  const elegible = selectCandidates({
    mission: state.mission,
    goal: null,
    candidates,
    pendingIntent: null,
    completedGoalIds: [],
    completedCandidateIds: [],
    completedCandidateKeys: [],
    goalsCreated: 0,
    tokensUsedTotal: 0,
    ownGoal: false,
    goalCandidate: null,
    goalCandidateKey: null,
    budgetAttempts: [],
    goalProgressSince: state.progress?.since ?? null,
    now: Date.now(),
  });

  const veredicto = decideNudge({
    missionStatus: state.mission.status,
    goalSignature: state.progress?.signature,
    goalProgressSince: state.progress?.since ?? null,
    hasEligibleWork: elegible.eligible.length > 0,
    lastNudgeAt: state.lastNudgeAt ?? null,
    now: Date.now(),
    stallTimeoutMs: state.mission.nudgeStallMs ?? DEFAULT_NUDGE_STALL_MS,
    cooldownMs: DEFAULT_NUDGE_COOLDOWN_MS,
  });

  console.log(veredicto.reason);
  if (!veredicto.nudge) return '';

  // La sesion tiene que seguir viva: si no esta, empujar es escribir al vacio.
  if (!state.sessionId) {
    return 'la mision no tiene sesion: no hay a quien empujar';
  }
  if (values['dry-run']) {
    return `[asi seria] mcode exec --session ${state.sessionId} --cwd ${state.mission.workspace}`;
  }

  const prompt =
    typeof values.prompt === 'string' && values.prompt ? values.prompt : readNudgePrompt(missionId);
  console.log(`inyectando desde ${nudgePromptPath(missionId)}`);
  const child = spawnSync(
    'mcode',
    [
      'exec',
      '--session',
      state.sessionId,
      '--cwd',
      state.mission.workspace,
      '--max-steps',
      '200',
      '--timeout',
      '10m',
      '--output-last-message',
      join(stateRoot(), missionId, 'last-nudge.txt'),
      prompt,
    ],
    { encoding: 'utf8' },
  );

  const salida = `${child.stderr || ''}\n${child.stdout || ''}`;
  const outcome = classifyPush(salida, child.status);

  // Solo un empujon que entro de verdad enfrria la cadena. Una sesion ocupada no
  // se ha empujado: esta trabajando, y cobrale el enfriamiento dejaria el
  // trabajo de verdad sinparable hasta media hora despues.
  if (cuentaComoEmpuje(outcome)) {
    state.lastNudgeAt = Date.now();
    await new FileJournal(missionId).saveAtomically(state);
  }

  if (outcome === 'delivered') return `sesion empujada: ${state.sessionId}`;
  if (outcome === 'session-busy') return 'la sesion esta ocupada: se reintentara en la proxima vuelta';
  return `el empujon no cuaja: ${salida.trim() || `codigo ${child.status}`}`;
}

/** Cada cuanto mira por defecto. Diez minutos es cuando ya se nota. */
const DEFAULT_WATCH_INTERVAL_MS = 10 * 60_000;

/** Convierte `10m`, `90s` o un numero de milisegundos en milisegundos. */
function parseInterval(raw: unknown, fallback: number): number {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  if (typeof raw !== 'string' || !raw.trim()) return fallback;
  const texto = raw.trim();
  const numero = Number(texto);
  if (Number.isFinite(numero) && numero > 0) return Math.floor(numero);
  const unidad = /^(\d+)\s*(ms|s|m|h)$/i.exec(texto);
  if (!unidad) return fallback;
  const factors: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 };
  return Number(unidad[1]) * (factors[unidad[2]!.toLowerCase()] ?? 1);
}

/**
 * Mira la cadena cada cierto rato y la empuja si se ha quedado esperando.
 *
 * Vive fuera de la sesion a proposito: el plugin solo reacciona a eventos del
 * host, y el caso que falta no produce ninguno —un objetivo quieto con la
 * sesion abierta no cierra ningun turno—. Aqui no hay sesion ni turno: hay un
 * reloj, y el reloj escribe en la sesion cuando toca. Es la unica pieza del
 * sistema que hace algo sin que pase nada, y por eso mismo es la que decide
 * cuando hay que empujar en vez de esperar.
 *
 * Un empujon por vuelta, y como mucho. Si el objetivo sigue quieto despues,
 * se respeta el enfriamiento: empujar mas seguido no continua la cadena, solo
 * gasta turnos.
 */
async function cmdWatch(values: Options): Promise<void> {
  const candado = takeWatchLock();
  if (!candado.tomado) {
    console.log(`ya hay un reloj mirando las misiones (proceso ${candado.dueno}): no se levanta otro`);
    return;
  }
  const cerrar = () => releaseWatchLock();
  process.on('exit', cerrar);

  const cada = parseInterval(values.every ?? values.interval, DEFAULT_WATCH_INTERVAL_MS);
  const verbose = values.quiet === undefined;
  const todas = values.all !== undefined;
  const misiones = todas ? todasLasMisiones() : [requireMissionId(values)];
  if (misiones.length === 0) {
    console.log('no hay ninguna mision declarada todavia');
    releaseWatchLock();
    return;
  }

  console.log(
    `vigilando ${misiones.length} mision(es) cada ${Math.round(cada / 1000)}s; Ctrl-C para parar`,
  );
  for (const id of misiones) readNudgePrompt(id);

  let vuelta = 0;
  while (true) {
    await new Promise((resolve) => setTimeout(resolve, cada));
    vuelta += 1;
    for (const missionId of misiones) {
      // El empujon va en segundo plano. Injectar tarda medio minuto, y una
      // vuelta no puede quedarse esperando a una sesion: si se atasca aqui,
      // las demas misiones dejan de mirarse justo cuando mas falta hacen.
      // El empujon escribe en el registro, no en la nada: una cadena que se
      // despierta sola sin dejar rastro es indistinguible de una que no.
      const hijo = spawn(process.execPath, [process.argv[1]!, 'nudge', '--mission', missionId], {
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      hijo.stdout?.on('data', (trozo: Buffer) => anotar(trozo.toString()));
      hijo.stderr?.on('data', (trozo: Buffer) => anotar(trozo.toString()));
      hijo.unref();
    }
    if (verbose) console.log(`vuelta ${vuelta}: ${misiones.length} mision(es) mirada(s)`);
  }
}

/** Lo que dice el reloj, con la hora, en un registro aparte. */
function anotar(texto: string): void {
  const destino = join(stateRoot(), 'watch.log');
  try {
    mkdirSync(dirname(destino), { recursive: true });
    appendFileSync(destino, `[${new Date().toISOString()}] ${texto}`);
  } catch {
    // Sin registro no hay drama: el empujon ya esta hecho o ya ha fallado.
  }
}

/** Todas las misiones que tienen estado guardado. */
function todasLasMisiones(): string[] {
  try {
    return readdirSync(stateRoot(), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .filter((entry) => existsSync(join(stateRoot(), entry.name, 'journal.json')))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

async function cmdNudge(values: Options): Promise<void> {
  const missionId = requireMissionId(values);
  console.log(await empujar(missionId, values, true));
}

const COMMANDS: Record<string, (values: Options) => Promise<void>> = {
  declare: cmdDeclare,
  init: cmdInit,
  run: cmdRun,
  status: cmdStatus,
  nudge: cmdNudge,
  watch: cmdWatch,
  pause: controlCommand('paused_by_user'),
  resume: controlCommand('running'),
  stop: controlCommand('stopped_by_user'),
  probe: cmdProbe,
  tree: cmdTree,
  doctor: cmdDoctor,
  'install-skill': cmdInstallSkill,
  'install-plugin': cmdInstallPlugin,
};

async function main(): Promise<void> {
  const { values, positionals } = parse(process.argv.slice(2));
  const command = positionals[0];

  if (values.help || !command) {
    console.log(USAGE);
    return;
  }

  const handler = COMMANDS[command];
  if (!handler) throw new Error(`comando desconocido: ${command}`);
  await handler(values);
}

main().catch((err) => {
  console.error(`ERROR ${(err as Error).message}`);
  process.exit(1);
});
