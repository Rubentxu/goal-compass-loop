#!/usr/bin/env node
/**
 * Interfaz de linea de comandos del supervisor de Goals.
 *
 * Los comandos son operaciones sobre una mision: preparar su estado durable,
 * arrancar el bucle, consultar el estado y ordenar al supervisor que pare,
 * pause o continue. La orden del usuario viaja por un canal de control
 * separado del journal, de modo que nunca se pisa el estado de ejecucion.
 */
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { AcpGoalAdapter } from './adapters/acp-goal.js';
import { FileControlPort } from './adapters/control.js';
import { FileJournal, journalPath } from './adapters/journal.js';
import { loadMissionConfig } from './adapters/mission.js';
import { openMission, ensureMissionState } from './runtime.js';
import {
  defaultMarketplaceDir,
  installPlugin,
  PLUGIN_NAME,
  projectRootFromModule,
} from './plugin/install.js';
import type { MissionStatus } from './core/types.js';

const logger = {
  info: (message: string) => console.log(`[${new Date().toISOString()}] ${message}`),
  warn: (message: string) => console.warn(`[${new Date().toISOString()}] AVISO ${message}`),
  error: (message: string) => console.error(`[${new Date().toISOString()}] ERROR ${message}`),
};

type Options = Record<string, unknown>;

const USAGE = `Goal Compass Loop · supervisor de Goals nativos

  goal-compass init   --config <mission.json>     prepara el estado durable de la mision
  goal-compass run    --config <mission.json>     arranca el bucle supervisor
  goal-compass status --mission <mission-id>      muestra el estado de la mision
  goal-compass pause|resume|stop --mission <id>   ordenes del usuario
  goal-compass probe  --workspace <dir>           comprueba la extension ACP del host
  goal-compass install-skill                       instala la skill goal-compass
  goal-compass install-plugin                      ensambla el plugin de MCode
`;

function parse(argv: string[]): { values: Options; positionals: string[] } {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      config: { type: 'string' },
      mission: { type: 'string' },
      workspace: { type: 'string' },
      'poll-ms': { type: 'string' },
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
  console.log('despues, en el repositorio que quieras encadenar, crea goal-compass.json');
  console.log('con la declaracion de la mision (missionId, objective y backlog).');
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

const COMMANDS: Record<string, (values: Options) => Promise<void>> = {
  init: cmdInit,
  run: cmdRun,
  status: cmdStatus,
  pause: controlCommand('paused_by_user'),
  resume: controlCommand('running'),
  stop: controlCommand('stopped_by_user'),
  probe: cmdProbe,
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
