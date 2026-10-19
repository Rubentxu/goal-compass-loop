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
import { join } from 'node:path';
import { AcpGoalAdapter } from '../src/adapters/acp-goal.js';
import { FileControlPort } from '../src/adapters/control.js';
import { FileJournal } from '../src/adapters/journal.js';
import { ComposedCandidatePort, MissionConfigCandidatePort, WorkspaceDiscovery } from '../src/adapters/candidates.js';
import { WorkspaceEvidenceScanner } from '../src/adapters/discovery.js';
import type { Candidate, Journal, Mission, MissionStatus } from '../src/core/types.js';
import { Supervisor } from '../src/supervisor.js';

/** Una comprobacion con nombre, tal y como aparece en el recibo. */
export interface Check {
  name: string;
  ok: boolean;
  detail?: string;
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
  /** Estado actual del journal. */
  readJournal(): Promise<Journal>;
  /** Anade o cambia un candidato en el fichero de la mision. */
  setCandidates(candidates: Candidate[]): Promise<void>;
  /** Cambia la orden de control del usuario. */
  setControl(status: MissionStatus): Promise<void>;
  /** Cambia un limite de la mision ya inicializada. */
  patchMission(patch: Partial<Mission>): Promise<void>;
  /** Reinicia el host ACP reanudando la misma sesion. */
  restartHost(): Promise<void>;
}

export interface Scenario {
  name: string;
  description: string;
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
): Promise<{ ok: boolean; checks: Check[] }> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const workspace = mkdtempSync(join(tmpdir(), `gcl-${scenario.name}-`));
  const missionId = `uat-${scenario.name}-${Date.now()}`;
  const log = options.quiet
    ? { info: () => {}, warn: () => {}, error: () => {} }
    : {
        info: (message: string) => console.log(`[${new Date().toISOString()}] ${message}`),
        warn: (message: string) => console.warn(`[${new Date().toISOString()}] AVISO ${message}`),
        error: (message: string) => console.error(`[${new Date().toISOString()}] ERROR ${message}`),
      };

  const journal = new FileJournal(missionId);
  const control = new FileControlPort(missionId);
  const missionFile = join(workspace, 'mission.json');
  let candidates: Candidate[] = [];
  let supervisor: Supervisor | undefined;
  let adapter: AcpGoalAdapter | undefined;

  const writeMissionFile = async (): Promise<void> => {
    writeFileSync(
      missionFile,
      JSON.stringify(
        {
          missionId,
          objective: `Escenario de aceptacion: ${scenario.name}`,
          workspace,
          defaultTokenBudget: 120_000,
          totalTokenBudget: null,
          maxGoals: null,
          allowRemoteWrite: false,
          backlog: candidates,
        },
        null,
        2,
      ),
    );
  };
  await writeMissionFile();

  await journal.saveAtomically({
    version: 1,
    missionId,
    sessionId: undefined,
    mission: {
      missionId,
      objective: `Escenario de aceptacion: ${scenario.name}`,
      status: 'running',
      defaultTokenBudget: 120_000,
      totalTokenBudget: null,
      maxGoals: null,
      workspace,
      backlog: [],
      allowRemoteWrite: false,
    },
    goals: [],
    intents: [],
    updatedAt: new Date().toISOString(),
  });

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
        candidatePort: new ComposedCandidatePort([
          new MissionConfigCandidatePort(missionFile),
          new WorkspaceDiscovery(new WorkspaceEvidenceScanner({ maxEvidence: 5 })),
        ]),
        journalPort: journal,
        controlPort: control,
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
    async patchMission(patch) {
      const state = await journal.load();
      if (!state) throw new Error('el journal no existe');
      state.mission = { ...state.mission, ...patch };
      await journal.saveAtomically(state);
    },
    async restartHost() {
      const sessionId = adapter?.sessionId();
      await adapter?.close();
      adapter = new AcpGoalAdapter({ workspace, sessionId, logger: log });
      await adapter.start();
    },
  };

  let checks: Check[] = [];
  let failure: string | undefined;

  try {
    adapter = new AcpGoalAdapter({ workspace, logger: log });
    await adapter.start();
    checks = await scenario.run(context);
  } catch (err) {
    failure = (err as Error).message;
  } finally {
    supervisor?.stop();
    await adapter?.close();
  }

  const ok = failure === undefined && checks.length > 0 && checks.every((check) => check.ok);
  printReceipt(scenario, checks, failure, workspace, missionId);

  if (!options.quiet) rmSync(workspace, { recursive: true, force: true });
  return { ok, checks };
}

function printReceipt(
  scenario: Scenario,
  checks: Check[],
  failure: string | undefined,
  workspace: string,
  missionId: string,
): void {
  console.log(`\n=============== RECIBO · ${scenario.name} ===============`);
  console.log(scenario.description);
  console.log(`workspace: ${workspace}`);
  console.log(`mision:    ${missionId}`);
  if (failure) console.log(`FALLO:     ${failure}`);
  console.log('--- comprobaciones ---');
  for (const check of checks) {
    console.log(`${check.ok ? 'PASA' : 'FALLA'} · ${check.name}${check.detail ? ` (${check.detail})` : ''}`);
  }
  console.log('===========================================================');
}

/** Crea un workspace con un fichero de ejemplo, para que el Goal tenga donde trabajar. */
export function seedWorkspace(workspace: string, name: string, content: string): void {
  mkdirSync(join(workspace, name.replace(/\//g, '-')), { recursive: true });
  writeFileSync(join(workspace, name), content);
}
