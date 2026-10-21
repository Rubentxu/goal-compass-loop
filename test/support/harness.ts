/**
 * Harness compartido de pruebas.
 *
 * Un solo lugar define como se construye el mundo de una prueba: la mision, el
 * candidato, el Goal y el snapshot, mas dobles en memoria que respetan las
 * reglas del host real (un unico Goal por sesion, pausa y reanudacion).
 *
 * Las pruebas de unidad y los escenarios de aceptacion usan este mismo
 * harness, de modo que lo que se comprueba en memoria y lo que se comprueba
 * contra el host real no pueden divergir en su modelo.
 */
import type { ChainLockHandle } from '../../src/ports.js';
import type {
  Candidate,
  GoalState,
  Journal,
  Mission,
  MissionStatus,
  Snapshot,
} from '../../src/core/types.js';
import { emptyMetrics } from '../../src/core/types.js';
import type { GoalPort, JournalPort } from '../../src/ports.js';

const NOW = 1_700_000_000_000;

/** Candidato valido y minimo. */
export function aCandidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    candidateId: 'c1',
    objective: 'Corregir el fallo de parseo',
    whyNow: 'Se reprodujo en la integracion continua',
    evidenceRefs: ['docs/triage.md#parseo'],
    doneWhen: ['La prueba que fallaba pasa'],
    risk: 'low',
    priority: 10,
    prerequisites: [],
    source: 'observed',
    ...overrides,
  };
}

/** Goal con la forma que devuelve el host. */
export function aGoal(overrides: Partial<GoalState> = {}): GoalState {
  return {
    goalId: 'tg_1',
    sessionId: 's1',
    objective: 'objetivo anterior',
    status: 'complete',
    createdAt: NOW - 1_000,
    updatedAt: NOW,
    tokensUsed: 100,
    turnsUsed: 1,
    timeUsedSeconds: 10,
    statusReason: 'complete(verifier_met)',
    executionWait: null,
    hasKickoffAttachments: false,
    ...overrides,
  };
}

/** Mision por defecto, en marcha y sin limites. */
export function aMission(overrides: Partial<Mission> = {}): Mission {
  return {
    missionId: 'm1',
    objective: 'Mejorar el proyecto',
    status: 'running',
    defaultTokenBudget: 100_000,
    totalTokenBudget: null,
    maxGoals: null,
    stallTimeoutMs: 45 * 60_000,
    explorationEnabled: true,
    explorationCooldownMs: 30 * 60_000,
    workspace: '/tmp/workspace',
    backlog: [],
    allowRemoteWrite: false,
    ...overrides,
  };
}

/** Snapshot por defecto: sin Goal, sin candidatos, sin trabajo hecho. */
export function aSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    mission: aMission(),
    goal: null,
    candidates: [],
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
    goalProgressSince: null,
    now: NOW,
    ...overrides,
  };
}

/** Journal vacio listo para usar. */
export function anEmptyJournal(mission: Mission = aMission()): Journal {
  return {
    version: 1,
    missionId: mission.missionId,
    sessionId: 's1',
    mission,
    goals: [],
    intents: [],
    progress: undefined,
    explored: [],
    explorationStreak: 0,
    lastExplorationAt: undefined,
    budgetAttempts: [],
    metrics: emptyMetrics(),
    updatedAt: new Date(NOW).toISOString(),
  };
}

/**
 * Host de Goals en memoria con las mismas reglas que el real:
 * una unica sesion, un unico Goal, y la creacion sustituye al anterior.
 */
export class MemoryGoalHost implements GoalPort {
  current: GoalState | null = null;
  createCount = 0;
  pauseCount = 0;
  resumeCount = 0;
  clearCount = 0;
  /** Presupuestos con los que se han creado los objetivos, en orden. */
  grantedBudgets: number[] = [];
  private counter = 0;

  async read(): Promise<GoalState | null> {
    return this.current;
  }

  async create(
    _sessionId: string,
    objective: string,
    tokenBudget: number | undefined,
  ): Promise<GoalState> {
    this.createCount += 1;
    this.counter += 1;
    this.grantedBudgets.push(tokenBudget ?? 0);
    this.current = aGoal({
      goalId: `tg_new_${this.counter}`,
      objective,
      status: 'active',
      createdAt: NOW,
      updatedAt: NOW,
      tokensUsed: 0,
      turnsUsed: 0,
      ...(tokenBudget !== undefined ? { tokenBudget } : {}),
      statusReason: null,
    });
    return this.current;
  }

  async pause(): Promise<GoalState | null> {
    this.pauseCount += 1;
    if (this.current) this.current = { ...this.current, status: 'paused' };
    return this.current;
  }

  async resume(): Promise<GoalState | null> {
    this.resumeCount += 1;
    if (this.current) this.current = { ...this.current, status: 'active' };
    return this.current;
  }

  /**
   * Libera el objetivo de la sesion.
   *
   * El host real guarda un unico objetivo por sesion: mientras haya uno, no
   * deja crear el siguiente.
   */
  async clear(): Promise<boolean> {
    this.clearCount += 1;
    const had = this.current !== null;
    this.current = null;
    return had;
  }

  sessionId(): string {
    return 's1';
  }

  async close(): Promise<void> {}

  /** Marca el Goal actual como terminado, como hace el runtime. */
  complete(tokensUsed = 1_000): GoalState {
    const completed = aGoal({
      ...(this.current ?? {}),
      status: 'complete',
      statusReason: 'complete(verifier_met)',
      tokensUsed,
      updatedAt: NOW,
    });
    this.current = completed;
    return completed;
  }

  /** Deja el objetivo actual sin presupuesto, como hace el host al agotarlo. */
  exhaust(tokensUsed: number): GoalState {
    const exhausted = aGoal({
      ...(this.current ?? {}),
      status: 'budget_limited',
      statusReason: 'budget_limited(token_budget_exhausted)',
      tokensUsed,
      updatedAt: NOW,
    });
    this.current = exhausted;
    return exhausted;
  }
}

/** Journal en memoria con escritura atomica simulada. */
export class MemoryJournal implements JournalPort {
  state: Journal;

  constructor(state: Journal = anEmptyJournal()) {
    this.state = state;
  }

  async load(): Promise<Journal> {
    return this.state;
  }

  async saveAtomically(journal: Journal): Promise<void> {
    this.state = journal;
  }
}

/** Canal de control en memoria, escribible desde la propia prueba. */
export class MemoryControl {
  status: MissionStatus | null = null;

  async read(): Promise<MissionStatus | null> {
    return this.status;
  }
}

/**
 * Un candado de mentira que lo tiene todo el mundo: suelta, dice que es suyo y
 * se renueva. Es lo que necesitan las pruebas que no van de propiedad.
 */
export function unCandado(): ChainLockHandle {
  const candado = (() => {}) as ChainLockHandle;
  candado.valid = () => true;
  candado.renew = () => {};
  return candado;
}
