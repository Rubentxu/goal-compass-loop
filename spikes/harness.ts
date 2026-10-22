/**
 * Harness de escenarios de aceptacion contra el host real.
 *
 * Un solo lugar sabe montar el mundo de un escenario: workspace aislado,
 * mision, journal, host ACP y supervisor. Los escenarios solo describen lo
 * que quieren comprobar, y el harness se encarga del resto: tiempo limite,
 *assercciones con nombre, recibo final y limpieza.
 *
 * Se espera por condicion observable (el estado del journal), nunca por un
 * tiempo fijo: si el host va lento, el escenario espera lo que necesite, y si
 * no llega, falla con un motivo claro.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { AcpGoalAdapter } from '../src/adapters/acp-goal.js';
import { FileControlPort } from '../src/adapters/control.js';
import { FileJournal, stateRoot } from '../src/adapters/journal.js';
import { ComposedCandidatePort } from '../src/adapters/candidates.js';
import { RuntimeGoalHistory } from '../src/adapters/goal-history.js';
import { SessionExploration } from '../src/adapters/exploration.js';
import { ChainLock } from '../src/adapters/ownership.js';
import { loadMissionConfig } from '../src/adapters/mission.js';
import { writeProposal } from '../src/adapters/proposals.js';
import { buildCandidatePorts, ensureMissionState } from '../src/runtime.js';
import { unaDeclaracion } from '../test/support/harness.js';
import type { Candidate, Journal, Mission, MissionStatus } from '../src/core/types.js';
import { Supervisor } from '../src/supervisor.js';

/** Una comprobacion con nombre, tal y como aparece en el recibo. */
export interface Check {
  name: string;
  ok: boolean;
  detail?: string;
  /**
   * La comprobacion no se pudo hacer porque el host dejo el trabajo a medias.
   *
   * No es un fallo del sistema: es trabajo que no llego a terminarse. Se
   * informa aparte, porque dar un rojo por una interrupcion ajena esconde el
   * fallo de verdad, y dar un verde por una comprobacion que no se hizo es
   * mentira.
   */
  skipped?: boolean;
}

/**
 * El host dejo un objetivo a medias.
 *
 * El verificador aborta, se agota un limite o el proceso se cae. El sistema no
 * puede hacer nada con eso: solo puede negarse a encadenar otro objetivo y
 * esperar. Por eso el escenario se marca como no corrido, no como fallido.
 */
export class HostInterruption extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HostInterruption';
  }
}

/** Como termino el trabajo en el host. */
export interface HostOutcome {
  /** Objetivos que llegaron a completarse. */
  completed: number;
  /** Por que se quedo trabajo a medias, si se quedo. */
  interruption?: string;
}

/** Utilidades que el escenario puede usar. */
export interface ScenarioContext {
  workspace: string;
  missionId: string;
  journal: FileJournal;
  control: FileControlPort;
  adapter: AcpGoalAdapter;
  /** Arranca el supervisor en segundo plano y devuelve su manejador. */
  startSupervisor(options?: { maxIterations?: number }): Supervisor;
  /** Espera a que se cumpla una condicion observable, o falla por tiempo. */
  waitFor(
    description: string,
    predicate: () => Promise<boolean>,
    timeoutMs?: number,
  ): Promise<void>;
  /** Espera a que se completen varios objetivos, o se rind cuenta. */
  waitForCompletedGoals(count: number): Promise<void>;
  /** Como termino el trabajo en el host: cuantos objetivos se completaron. */
  hostOutcome(): Promise<HostOutcome>;
  /** Estado actual del journal. */
  readJournal(): Promise<Journal>;
  /** Anade o cambia un candidato en el fichero de la mision. */
  setCandidates(candidates: Candidate[]): Promise<void>;
  /** Cambia la orden de control del usuario. */
  setControl(status: MissionStatus): Promise<void>;
  /** Registra una propuesta de trabajo, como haria el agente con la herramienta. */
  propose(proposal: {
    objective: string;
    evidence: string;
    whyNow?: string;
    doneWhen?: string[];
  }): void;
  /** Cambia un limite de la mision ya inicializada. */
  patchMission(patch: Partial<Mission>): Promise<void>;
  /**
   * Reinicia el host ACP.
   *
   * Con `nuevaSesion` el host arranca en una sesion distinta: la anterior se
   * queda sin dueno y sus objetivos se van con ella, que es lo que pasa cuando
   * la sesion se cierra de verdad.
   */
  restartHost(nuevaSesion?: boolean): Promise<void>;
  /**
   * Si el registro del escenario contiene un texto.
   *
   * Sirve para distinguir quien encadeno un objetivo: el supervisor lo
   * anuncia con su propia frase y el hook con la suya.
   */
  logContains(text: string): boolean;
}

export interface Scenario {
  name: string;
  description: string;
  /** Margen particular del escenario, cuando necesita mas o menos que el general. */
  timeoutMs?: number;
  run(context: ScenarioContext): Promise<Check[]>;
}

export interface ScenarioOptions {
  /** Milisegundos que puede durar el escenario antes de darse por fallido. */
  timeoutMs?: number;
  /** Silenciar el log del supervisor. */
  quiet?: boolean;
}

const DEFAULT_TIMEOUT_MS = 12 * 60_000;

/**
 * Ejecuta un escenario completo y devuelve su recibo.
 */
export async function runScenario(
  scenario: Scenario,
  options: ScenarioOptions = {},
): Promise<{ ok: boolean; checks: Check[]; interrupted: boolean; skipped: number }> {
  const timeoutMs = options.timeoutMs ?? scenario.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const workspace = mkdtempSync(join(tmpdir(), `gcl-${scenario.name}-`));
  const missionId = `uat-${scenario.name}-${Date.now()}`;
  // El registro se guarda siempre, aunque no se muestre: el escenario lo
  // consulta para saber que hizo cada camino.
  const register: string[] = [];
  const stamp = (): string => `[${new Date().toISOString()}]`;
  const log = {
    info: (message: string) => {
      register.push(message);
      if (!options.quiet) console.log(`${stamp()} ${message}`);
    },
    warn: (message: string) => {
      register.push(message);
      if (!options.quiet) console.warn(`${stamp()} AVISO ${message}`);
    },
    error: (message: string) => {
      register.push(message);
      if (!options.quiet) console.error(`${stamp()} ERROR ${message}`);
    },
  };

  const journal = new FileJournal(missionId);
  const control = new FileControlPort(missionId);
  // El plugin busca la declaracion por su nombre. El arnes usa el mismo
  // nombre que el producto, para que la via que se aparta sea la real.
  const missionFile = join(workspace, 'goal-compass.json');
  let candidates: Candidate[] = [];
  let supervisor: Supervisor | undefined;
  let adapter: AcpGoalAdapter | undefined;

  const writeMissionFile = async (): Promise<void> => {
    unaDeclaracion(workspace, {
      missionId,
      objective: `Escenario de aceptacion: ${scenario.name}`,
      // El escenario mide el camino del supervisor. Declararlo deja al hook
      // del plugin aparte, que si no se adelantaria a encadenar.
      driver: 'supervisor',
      backlog: candidates,
    });
  };
  await writeMissionFile();

  // El estado durable lo prepara el producto, no el arnes. Si el arnes escribe
  // el estado a mano, el escenario mide un sistema que no existe: en cuanto el
  // estado gana un campo, el arnes se queda con el estado viejo y el fallo
  // aparece como un fallo del escenario.
  await ensureMissionState(loadMissionConfig(missionFile, { workspace }), journal, log);

  const deadline = Date.now() + timeoutMs;
  const context: ScenarioContext = {
    workspace,
    missionId,
    journal,
    control,
    get adapter() {
      if (!adapter) throw new Error('el host ACP no esta conectado');
      return adapter;
    },
    startSupervisor(startOptions = {}) {
      supervisor = new Supervisor({
        goalPort: adapter!,
        // Las mismas fuentes que usa el producto: si el arnes montara las suyas,
        // los escenarios estarian probando otro sistema.
        candidatePort: new ComposedCandidatePort(
          buildCandidatePorts(missionFile, workspace, { maxEvidence: 5 }),
        ),
        journalPort: journal,
        historyPort: new RuntimeGoalHistory(),
        chainLock: new ChainLock(missionId),
        controlPort: control,
        explorationPort: new SessionExploration(adapter!, workspace),
        clock: { now: () => Date.now() },
        logger: log,
        pollIntervalMs: 3_000,
        parkedPollIntervalMs: 3_000,
        ...(startOptions.maxIterations !== undefined
          ? { maxIterations: startOptions.maxIterations }
          : {}),
      });
      void supervisor.run();
      return supervisor;
    },
    async waitFor(description, predicate, waitTimeoutMs = timeoutMs) {
      const limit = Math.min(Date.now() + waitTimeoutMs, deadline);
      while (Date.now() < limit) {
        if (await predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      throw new Error(`tiempo agotado esperando: ${description}`);
    },
    async waitForCompletedGoals(count) {
      try {
        await this.waitFor(`${count} objetivos terminados`, async () => {
          const state = await journal.load();
          return (state?.goals.length ?? 0) >= count;
        });
      } catch (err) {
        const outcome = await this.hostOutcome();
        if (outcome.interruption) throw new HostInterruption(outcome.interruption);
        throw err;
      }
    },
    async hostOutcome() {
      const state = await journal.load();
      const completed = state?.goals.length ?? 0;
      const recorded = new Set((state?.goals ?? []).map((record) => record.goalId));
      const pending = (state?.intents ?? []).filter(
        (intent) => intent.status === 'committed' && intent.goalId && !recorded.has(intent.goalId),
      );
      if (pending.length === 0) return { completed };

      const goal = adapter
        ? await adapter.read(adapter.sessionId()).catch(() => null)
        : null;
      const reason = goal?.statusReason ?? goal?.status ?? 'el host no lo termino';
      return {
        completed,
        interruption: `el host interrumpio el objetivo ${pending[0]!.goalId} (${reason})`,
      };
    },
    async readJournal() {
      const state = await journal.load();
      if (!state) throw new Error('el journal no existe');
      return state;
    },
    async setCandidates(next) {
      candidates = next;
      await writeMissionFile();
    },
    async setControl(status) {
      await control.write(status);
    },
    propose(proposal) {
      writeProposal(missionId, {
        candidateId: `propuesta:${proposal.objective}`.slice(0, 120),
        objective: proposal.objective,
        whyNow: proposal.whyNow ?? 'propuesta surgida durante la sesion',
        evidenceRefs: [proposal.evidence],
        doneWhen: proposal.doneWhen ?? [],
        createdAt: new Date().toISOString(),
      });
    },
    async patchMission(patch) {
      const state = await journal.load();
      if (!state) throw new Error('el journal no existe');
      state.mission = { ...state.mission, ...patch };
      await journal.saveAtomically(state);
    },
    async restartHost(nuevaSesion = false) {
      const sessionId = nuevaSesion ? undefined : adapter?.sessionId();
      await adapter?.close();
      adapter = new AcpGoalAdapter({
        workspace,
        ...(sessionId !== undefined ? { sessionId } : {}),
        logger: log,
      });
      await adapter.start();
    },
    logContains(text: string) {
      return register.some((line) => line.includes(text));
    },
  };

  let checks: Check[] = [];
  let failure: string | undefined;
  let interrupted = false;

  try {
    adapter = new AcpGoalAdapter({ workspace, logger: log });
    await adapter.start();
    checks = await scenario.run(context);
  } catch (err) {
    if (err instanceof HostInterruption) {
      interrupted = true;
      failure = err.message;
    } else {
      failure = (err as Error).message;
    }
  } finally {
    supervisor?.stop();
    await adapter?.close();
  }

  const failed = checks.filter((check) => !check.ok && !check.skipped);
  const skipped = checks.filter((check) => check.skipped);
  const ok =
    !interrupted &&
    failure === undefined &&
    checks.length > 0 &&
    failed.length === 0 &&
    checks.some((check) => check.ok && !check.skipped);
  printReceipt(scenario, checks, failure, workspace, missionId, interrupted);

  if (!options.quiet) {
    rmSync(workspace, { recursive: true, force: true });
    // La mision del escenario tambien se va. Si se queda, el diagnostico la
    // cuenta entre las misiones con problemas y ensucia lo que dice de las
    // que de verdad importan.
    rmSync(join(stateRoot(), missionId), { recursive: true, force: true });
  }
  return { ok, checks, interrupted, skipped: skipped.length };
}

function printReceipt(
  scenario: Scenario,
  checks: Check[],
  failure: string | undefined,
  workspace: string,
  missionId: string,
  interrupted: boolean,
): void {
  console.log(`\n=============== RECIBO · ${scenario.name} ===============`);
  console.log(scenario.description);
  console.log(`workspace: ${workspace}`);
  console.log(`mision:    ${missionId}`);
  if (interrupted) console.log(`NO CORRIO: ${failure}`);
  else if (failure) console.log(`FALLO:     ${failure}`);
  console.log('--- comprobaciones ---');
  for (const check of checks) {
    const verdict = check.skipped ? 'NO CORRIO' : check.ok ? 'PASA' : 'FALLA';
    console.log(`${verdict} · ${check.name}${check.detail ? ` (${check.detail})` : ''}`);
  }
  console.log('===========================================================');
}

/**
 * Crea un fichero de ejemplo en el workspace, para que el Goal tenga donde
 * trabajar y para que la evidencia de una propuesta senale a algo real.
 */
export function seedWorkspace(workspace: string, name: string, content: string): void {
  const path = join(workspace, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}
