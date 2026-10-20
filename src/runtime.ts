/**
 * Montaje de una mision: sus adaptadores y su supervisor.
 *
 * El montaje vive aqui y no en la interfaz de linea de comandos porque hay
 * dos formas de arrancar la misma mision: el bucle de fondo, y el disparo
 * puntual que encadena el siguiente objetivo cuando el agente termina su
 * turno. Las dos comparten exactamente el mismo cableado.
 */
import { basename } from 'node:path';
import { AcpGoalAdapter } from './adapters/acp-goal.js';
import { FileControlPort } from './adapters/control.js';
import { FileJournal } from './adapters/journal.js';
import { loadMissionConfig, sameWorkspace, toMission, type MissionConfig } from './adapters/mission.js';
import {
  ComposedCandidatePort,
  MissionConfigCandidatePort,
  WorkspaceDiscovery,
} from './adapters/candidates.js';
import { WorkspaceEvidenceScanner } from './adapters/discovery.js';
import { SessionExploration } from './adapters/exploration.js';
import { ChainLock, decideDriving } from './adapters/ownership.js';
import { ProposalCandidatePort } from './adapters/proposals.js';
import type { Driver, Journal } from './core/types.js';
import type { CandidatePort, Logger } from './ports.js';
import { Supervisor } from './supervisor.js';

export interface MissionRuntimeOptions {
  /** Configuracion de la mision ya leida. */
  config: MissionConfig;
  /** Ruta del fichero de configuracion: el backlog se relee de ahi. */
  configPath: string;
  logger: Logger;
  /** Camino que pide conducir la mision. */
  driver?: Driver;
  /** Sesion ya existente que hay que Adoptar en lugar de crear. */
  sessionId?: string | undefined;
  /** Ejecutable del host y sus argumentos, cuando no es el de por defecto. */
  host?: { command?: string; args?: string[] } | undefined;
  /** Permite preguntar al agente por trabajo que las fuentes no ven. */
  exploration?: boolean;
  pollIntervalMs?: number;
  maxIterations?: number;
}

export interface MissionRuntime {
  supervisor: Supervisor;
  adapter: AcpGoalAdapter;
  journal: FileJournal;
  /** Si este camino puede conducir la mision. */
  driving: boolean;
  /** Por que no, cuando no puede. */
  reason?: string;
}

/**
 * Fuentes de trabajo, en orden de prioridad.
 *
 * El backlog declarado manda, despues lo que se ha propuesto durante la
 * sesion (ya viene investigada y con su evidencia puesta) y por ultimo las
 * senales automaticas del repositorio.
 *
 * La prioridad no la da el orden de la lista, sino la que cada fuente
 * asigna a sus candidatos: el backlog la fija el usuario, las propuestas
 * van a medias y las senales del repositorio son lo mas bajo. Un unico
 * lugar decide de donde sale el trabajo, para que el supervisor y las
 * pruebas de aceptacion no puedan divergir.
 */
export interface CandidatePortOptions {
  /** Maximo de senales del workspace que se ofrecen como trabajo. */
  maxEvidence?: number;
}

export function buildCandidatePorts(
  configPath: string,
  workspace: string,
  options: CandidatePortOptions = {},
): CandidatePort[] {
  const scanner = new WorkspaceEvidenceScanner(
    options.maxEvidence === undefined ? {} : { maxEvidence: options.maxEvidence },
  );
  return [
    new MissionConfigCandidatePort(configPath),
    new ProposalCandidatePort(workspace),
    new WorkspaceDiscovery(scanner),
  ];
}

/**
 * Prepara el estado durable de la mision si todavia no existe.
 *
 * No toca el host: solo deja el journal listo para que el supervisor lo
 * use mas adelante.
 */
export async function ensureMissionState(
  config: MissionConfig,
  journal: FileJournal,
  logger: Logger,
): Promise<Journal> {
  const existing = await journal.load();
  if (!existing) {
    const initial: Journal = {
      version: 1,
      missionId: config.missionId,
      sessionId: undefined,
      mission: toMission(config),
      goals: [],
      intents: [],
      progress: undefined,
      explored: [],
      explorationStreak: 0,
      lastExplorationAt: undefined,
      updatedAt: new Date().toISOString(),
    };
    await journal.saveAtomically(initial);
    logger.info(`mision "${config.missionId}" inicializada en ${journal.filePath}`);
    return initial;
  }
  return existing;
}

/**
 * Prepara el estado durable de la mision si todavia no existe y deja el
 * supervisor listo para trabajar.
 */
export async function openMission(options: MissionRuntimeOptions): Promise<MissionRuntime> {
  const { config, configPath, logger } = options;
  const driver = options.driver ?? 'supervisor';
  const journal = new FileJournal(config.missionId);

  const existing = await journal.load();
  const mission = existing?.mission ?? toMission(config);

  // El estado durable vive fuera del repositorio, en una carpeta que se nombra
  // con el identificador de la mision. Dos proyectos que compartan
  // identificador se pisarian en silencio y cada uno creeria que esta solo.
  // Antes de tocar nada se comprueba que el estado que ya hay es de este
  // proyecto; si es de otro, esta mision no conduce y dice por que.
  const foreign = existing?.mission.workspace;
  const conflict =
    foreign && !sameWorkspace(foreign, config.workspace)
      ? `la mision "${config.missionId}" ya tiene estado del proyecto ` +
        `"${basename(foreign)}": declara esa mision con otro identificador`
      : undefined;

  // El mando decide si este camino puede actuar. Sin declaracion, lo toma el
  // primero que llegue; con declaracion, manda lo declarado.
  const driving = decideDriving({
    mission,
    driver,
    declared: config.driver,
    now: Date.now(),
  });

  let supervisor: Supervisor | undefined;
  const adapter = new AcpGoalAdapter({
    workspace: config.workspace,
    sessionId: options.sessionId ?? existing?.sessionId,
    ...(options.host?.command !== undefined ? { command: options.host.command } : {}),
    ...(options.host?.args !== undefined ? { args: options.host.args } : {}),
    logger,
    onGoalUpdate: (event) => {
      logger.info(
        `cambio de goal: estado=${event.goal?.status ?? 'sin goal'} ` +
          `turnos=${event.goal?.turnsUsed ?? '-'} tokens=${event.goal?.tokensUsed ?? '-'}`,
      );
      supervisor?.notify();
    },
  });

  supervisor = new Supervisor({
    goalPort: adapter,
    candidatePort: new ComposedCandidatePort(buildCandidatePorts(configPath, config.workspace)),
    journalPort: journal,
    chainLock: new ChainLock(config.missionId),
    controlPort: new FileControlPort(config.missionId),
    ...(options.exploration === false
      ? {}
      : { explorationPort: new SessionExploration(adapter, config.workspace) }),
    clock: { now: () => Date.now() },
    logger,
    ...(options.pollIntervalMs !== undefined ? { pollIntervalMs: options.pollIntervalMs } : {}),
    ...(options.maxIterations !== undefined ? { maxIterations: options.maxIterations } : {}),
  });

  // El camino que no conduce se aparta entero: no abre el host, no escribe en
  // el journal y no deja el estado a medias. Apartarse no puede consistir en
  // dejar a medias lo que va a trabajar otro camino.
  if (!driving.drive || conflict) {
    const reason = conflict ?? driving.reason;
    return {
      supervisor,
      adapter,
      journal,
      driving: false,
      ...(reason !== undefined ? { reason } : {}),
    };
  }

  const state = existing ?? (await ensureMissionState(config, journal, logger));
  const before = JSON.stringify(state);

  // El fichero de mision manda sobre la intencion (backlog, workspace,
  // presupuestos); el journal conserva el estado de ejecucion.
  state.mission.backlog = config.backlog;
  state.mission.workspace = config.workspace;
  state.mission.defaultTokenBudget = config.defaultTokenBudget;
  state.mission.totalTokenBudget = config.totalTokenBudget;
  state.mission.maxGoals = config.maxGoals;
  state.mission.stallTimeoutMs = config.stallTimeoutMs;
  state.mission.explorationEnabled = config.explorationEnabled;
  state.mission.explorationCooldownMs = config.explorationCooldownMs;
  state.mission.allowRemoteWrite = config.allowRemoteWrite;

  // Quien conduce deja su nombre y el momento en que lo tomo.
  state.mission.driver = driver;
  state.mission.driverAt = Date.now();

  // Solo se escribe cuando algo cambio: reescribir el journal entero sin
  // motivo puede pisar lo que otro proceso acaba de escribir.
  if (JSON.stringify(state) !== before) {
    await journal.saveAtomically(state);
  }

  await adapter.start();
  if (state.sessionId !== adapter.sessionId()) {
    state.sessionId = adapter.sessionId();
    await journal.saveAtomically(state);
  }

  return {
    supervisor,
    adapter,
    journal,
    driving: true,
  };
}
