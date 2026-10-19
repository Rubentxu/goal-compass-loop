/**
 * Supervisor: el unico actor con autoridad para crear Goals.
 *
 * Ciclo:
 *   observar -> decidir (nucleo puro) -> ejecutar (efectos) -> persistir
 *
 * Garantias:
 *  - Solo `complete` habilita crear el siguiente Goal.
 *  - La transicion es durable: intencion -> creacion -> read-back -> commit.
 *  - Un fallo entre creacion y commit se reconcilia leyendo el estado real:
 *    nunca hay Goals duplicados.
 *  - Las notificaciones repetidas no crean Goals repetidos: la autoridad es
 *    el estado, no el evento.
 *  - Los limites del host (paused/blocked/budget_limited/usage_limited) no se
 *    esquivan, y tampoco los limites de la propia mision.
 */
import { randomUUID } from 'node:crypto';
import { decide } from './core/decide.js';
import {
  candidateKey,
  normalize,
  type Candidate,
  type GoalRecord,
  type GoalState,
  type Journal,
  type Mission,
  type Snapshot,
  type TransitionIntent,
} from './core/types.js';
import type { CandidatePort, Clock, GoalPort, JournalPort, Logger } from './ports.js';

export interface SupervisorOptions {
  goalPort: GoalPort;
  candidatePort: CandidatePort;
  journalPort: JournalPort;
  /** Canal de control del usuario, en un fichero aparte del journal. */
  controlPort: { read(): Promise<Mission['status'] | null> };
  clock: Clock;
  logger: Logger;
  /** Intervalo de sondeo mientras se espera (ms). */
  pollIntervalMs?: number;
  /** Intervalo de sondeo en estado parked (ms). */
  parkedPollIntervalMs?: number;
  /** Limite de iteraciones del bucle, como proteccion en pruebas. */
  maxIterations?: number;
  /** Fallos consecutivos tolerados antes de detener la cadena. */
  maxConsecutiveErrors?: number;
}

const DEFAULT_POLL_MS = 15_000;
const DEFAULT_PARKED_POLL_MS = 30_000;
const DEFAULT_MAX_CONSECUTIVE_ERRORS = 5;

/** Despertador: una notificacion reduce la latencia del sondeo. */
class WakeSignal {
  private resolver: (() => void) | null = null;

  notify(): void {
    this.resolver?.();
  }

  wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.resolver = null;
        resolve();
      }, ms);
      timer.unref?.();
      this.resolver = () => {
        clearTimeout(timer);
        this.resolver = null;
        resolve();
      };
    });
  }
}

export class Supervisor {
  private readonly goalPort: GoalPort;
  private readonly candidatePort: CandidatePort;
  private readonly journalPort: JournalPort;
  private readonly controlPort: SupervisorOptions['controlPort'];
  private readonly clock: Clock;
  private readonly logger: Logger;
  private readonly pollIntervalMs: number;
  private readonly parkedPollIntervalMs: number;
  private readonly maxIterations: number | undefined;
  private readonly maxConsecutiveErrors: number;
  private readonly wakeSignal = new WakeSignal();
  private stopped = false;

  constructor(options: SupervisorOptions) {
    this.goalPort = options.goalPort;
    this.candidatePort = options.candidatePort;
    this.journalPort = options.journalPort;
    this.controlPort = options.controlPort;
    this.clock = options.clock;
    this.logger = options.logger;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_MS;
    this.parkedPollIntervalMs = options.parkedPollIntervalMs ?? DEFAULT_PARKED_POLL_MS;
    this.maxIterations = options.maxIterations;
    this.maxConsecutiveErrors = options.maxConsecutiveErrors ?? DEFAULT_MAX_CONSECUTIVE_ERRORS;
  }

  /** Avisa al bucle: normalmente desde una notificacion de cambio de Goal. */
  notify(): void {
    this.wakeSignal.notify();
  }

  /** Detiene el bucle de forma cooperativa. */
  stop(): void {
    this.stopped = true;
    this.wakeSignal.notify();
  }

  /** Bucle principal. Termina cuando la mision se detiene o se agota el limite de iteraciones. */
  async run(): Promise<void> {
    let iterations = 0;
    let consecutiveErrors = 0;

    while (!this.stopped) {
      iterations += 1;
      if (this.maxIterations !== undefined && iterations > this.maxIterations) {
        this.logger.info(`limite de iteraciones alcanzado (${iterations - 1})`);
        return;
      }

      try {
        const decision = await this.evaluate();
        consecutiveErrors = 0;
        this.logger.info(`decision: ${decision.kind} - ${decision.reason}`);
        await this.execute(decision);
      } catch (err) {
        consecutiveErrors += 1;
        const message = (err as Error).message;
        this.logger.error(`ciclo fallido (${consecutiveErrors}/${this.maxConsecutiveErrors}): ${message}`);
        if (consecutiveErrors >= this.maxConsecutiveErrors) {
          await this.executeEscalate(`fallos repetidos del ciclo: ${message}`);
          return;
        }
        await this.wakeSignal.wait(this.pollIntervalMs);
      }
    }
  }

  private async execute(decision: ReturnType<typeof decide>): Promise<void> {
    switch (decision.kind) {
      case 'create':
        await this.executeCreate(decision.candidate);
        return;
      case 'reconcile':
        await this.executeReconcile(decision.intent);
        return;
      case 'park':
        await this.executePark(decision.reason);
        return;
      case 'wait':
        await this.executeWait();
        return;
      case 'escalate':
        await this.executeEscalate(decision.reason);
    }
  }

  // ---------------------------------------------------------------- observar

  /** Construye el snapshot desde el estado real y decide. */
  async evaluate(): Promise<ReturnType<typeof decide>> {
    const journal = await this.loadJournal();
    const sessionId = this.goalPort.sessionId();

    let goal = await this.goalPort.read(sessionId);
    goal = await this.applyControl(journal, goal);
    await this.syncCompletedGoal(journal, goal);

    const candidates = await this.candidatePort.discover(journal.mission, goal);
    return decide(this.buildSnapshot(journal, goal, candidates));
  }

  private buildSnapshot(
    journal: Journal,
    goal: GoalState | null,
    candidates: Candidate[],
  ): Snapshot {
    // Un Goal ya terminado y registrado no se vuelve a sumar: contarlo dos
    // veces consumiria el presupuesto de la mision al doble de velocidad.
    const recorded = new Set(journal.goals.map((record) => record.goalId));
    const tokensUsedTotal =
      journal.goals.reduce((total, record) => total + record.tokensUsed, 0) +
      (goal && !recorded.has(goal.goalId) ? goal.tokensUsed : 0);

    return {
      mission: journal.mission,
      goal,
      candidates,
      pendingIntent: journal.intents.find((intent) => intent.status === 'intent') ?? null,
      completedGoalIds: journal.goals.map((record) => record.goalId),
      completedCandidateIds: journal.goals
        .map((record) => record.candidateId)
        .filter((id): id is string => typeof id === 'string'),
      completedCandidateKeys: journal.goals
        .map((record) => record.candidateKey)
        .filter((key): key is string => typeof key === 'string'),
      goalsCreated: journal.intents.filter((intent) => intent.status === 'committed').length,
      tokensUsedTotal,
      now: this.clock.now(),
    };
  }

  /**
   * Traduce la orden del usuario en estado de la mision y en estado del Goal.
   * Pausar la mision pausa tambien el Goal en curso, para que deje de gastar.
   */
  private async applyControl(journal: Journal, goal: GoalState | null): Promise<GoalState | null> {
    const control = await this.controlPort.read();
    if (!control) return goal;

    if (control !== journal.mission.status) {
      journal.mission.status = control;
      journal.mission.reason =
        control === 'running' ? undefined : 'ordenado por el usuario';
      await this.saveJournal(journal);
      this.logger.info(`control del usuario aplicado: ${control}`);
    }

    const sessionId = this.goalPort.sessionId();
    if (control === 'paused_by_user' || control === 'stopped_by_user') {
      if (goal?.status === 'active') {
        const paused = await this.goalPort.pause(sessionId);
        this.logger.info('goal pausado para dejar de consumir presupuesto');
        return paused ?? goal;
      }
    } else if (control === 'running' && goal?.status === 'paused') {
      const resumed = await this.goalPort.resume(sessionId);
      this.logger.info('goal reanudado');
      return resumed ?? goal;
    }

    if (control === 'stopped_by_user') this.stop();
    return goal;
  }

  /** Registra en el journal un Goal recien completado, una sola vez por Goal. */
  private async syncCompletedGoal(journal: Journal, goal: GoalState | null): Promise<void> {
    if (!goal || goal.status !== 'complete') return;
    if (journal.goals.some((record) => record.goalId === goal.goalId)) return;

    const intent = journal.intents.find((entry) => entry.goalId === goal.goalId);
    const record: GoalRecord = {
      goalId: goal.goalId,
      objective: goal.objective,
      status: goal.status,
      statusReason: goal.statusReason,
      tokensUsed: goal.tokensUsed,
      turnsUsed: goal.turnsUsed,
      startedAt: goal.createdAt,
      endedAt: goal.updatedAt,
      candidateId: intent?.candidateId,
      candidateKey: intent?.candidateKey,
      receipt: goal.lastVerification?.reason?.slice(0, 200),
    };
    journal.goals.push(record);
    await this.saveJournal(journal);
    this.logger.info(
      `goal completado registrado: ${goal.goalId} (${goal.statusReason ?? 'sin motivo'})`,
    );
  }

  // ---------------------------------------------------------------- ejecutar

  /**
   * Transicion durable: intencion -> creacion -> read-back -> commit.
   */
  private async executeCreate(candidate: Candidate): Promise<void> {
    const journal = await this.loadJournal();
    const sessionId = this.goalPort.sessionId();

    // Reconfirmar el estado antes de crear: solo un Goal terminado habilita.
    const current = await this.goalPort.read(sessionId);
    if (current && current.status !== 'complete') {
      this.logger.info(
        `creacion cancelada: el goal actual esta en "${current.status}", no en "complete"`,
      );
      return;
    }

    const tokenBudget = candidate.tokenBudget ?? journal.mission.defaultTokenBudget;
    const intent: TransitionIntent = {
      intentId: randomUUID(),
      candidateId: candidate.candidateId,
      candidateKey: candidateKey(candidate),
      objective: candidate.objective,
      tokenBudget,
      createdAt: new Date(this.clock.now()).toISOString(),
      status: 'intent',
    };

    // La intencion se persiste antes de tocar el host: si el proceso muere
    // aqui, el reinicio sabra que hay que reconciliar.
    journal.intents.push(intent);
    await this.saveJournal(journal);
    this.logger.info(`intencion persistida: ${candidate.candidateId} -> ${intent.intentId}`);

    let created: GoalState;
    try {
      created = await this.goalPort.create(sessionId, candidate.objective, tokenBudget);
    } catch (err) {
      // La intencion sigue sin confirmar: se reconciliara en el proximo ciclo.
      this.logger.error(`la creacion del goal fallo: ${(err as Error).message}`);
      return;
    }

    const readBack = await this.goalPort.read(sessionId);
    const confirmed = readBack?.goalId === created.goalId ? readBack : created;

    this.commitIntent(journal, intent.intentId, confirmed.goalId);
    await this.saveJournal(journal);

    this.logger.info(
      `goal creado y confirmado: ${confirmed.goalId} (${confirmed.status}) - ${candidate.objective.slice(0, 80)}`,
    );
  }

  /**
   * Reconcilia una intencion sin confirmar contra el estado real del host.
   * Nunca se vuelve a crear a ciegas: primero se pregunta.
   */
  private async executeReconcile(intent: TransitionIntent): Promise<void> {
    const journal = await this.loadJournal();
    const sessionId = this.goalPort.sessionId();

    this.logger.info(`reconciliando intencion ${intent.intentId} (${intent.candidateId})`);
    const goal = await this.goalPort.read(sessionId);

    if (goal && matchesIntent(goal, intent)) {
      // La creacion llego al host: solo faltaba el commit local.
      this.commitIntent(journal, intent.intentId, goal.goalId);
      await this.saveJournal(journal);
      this.logger.info(
        `reconciliado sin duplicar: el goal ${goal.goalId} ya era el creado por la intencion`,
      );
      return;
    }

    if (goal) {
      // Hay un Goal pero no es el nuestro: otra autoridad intervino.
      this.discardIntent(journal, intent.intentId);
      journal.mission.status = 'escalated';
      journal.mission.reason =
        `conflicto de autoridad: el goal ${goal.goalId} ("${goal.objective.slice(0, 60)}") ` +
        `no corresponde a la intencion ${intent.intentId}`;
      await this.saveJournal(journal);
      this.logger.error(journal.mission.reason);
      this.stop();
      return;
    }

    // No hay Goal: la creacion nunca llego, asi que reintentar es seguro.
    this.discardIntent(journal, intent.intentId);
    await this.saveJournal(journal);
    this.logger.warn(
      `intencion ${intent.intentId} descartada: el host no tiene ningun goal; se vuelve a decidir`,
    );
  }

  /** Sin trabajo elegible: la mision sigue viva pero dormida. */
  private async executePark(reason: string): Promise<void> {
    const journal = await this.loadJournal();
    if (journal.mission.status !== 'parked') {
      journal.mission.status = 'parked';
      journal.mission.reason = reason;
      await this.saveJournal(journal);
      this.logger.info(`mision en parked: ${reason}`);
    }
    await this.wakeSignal.wait(this.parkedPollIntervalMs);
  }

  /** El Goal sigue vivo o el host impone un limite: solo esperar. */
  private async executeWait(): Promise<void> {
    await this.wakeSignal.wait(this.pollIntervalMs);
  }

  /** Conflicto que exige intervencion humana: la mision se detiene. */
  private async executeEscalate(reason: string): Promise<void> {
    const journal = await this.loadJournal();
    journal.mission.status = 'escalated';
    journal.mission.reason = reason;
    await this.saveJournal(journal);
    this.logger.error(`mision escalada: ${reason}`);
    this.stop();
  }

  // ---------------------------------------------------------------- journal

  private commitIntent(journal: Journal, intentId: string, goalId: string): void {
    const intent = journal.intents.find((entry) => entry.intentId === intentId);
    if (!intent) return;
    intent.status = 'committed';
    intent.goalId = goalId;
  }

  private discardIntent(journal: Journal, intentId: string): void {
    const intent = journal.intents.find((entry) => entry.intentId === intentId);
    if (intent) intent.status = 'obsolete';
  }

  /**
   * El journal se relee del disco en cada ciclo: el supervisor es su unico
   * escritor, pero el usuario puede editarlo y el estado debe reflectirse.
   */
  private async loadJournal(): Promise<Journal> {
    const existing = await this.journalPort.load();
    if (!existing) {
      throw new Error(
        'journal vacio: inicializa la mision antes de arrancar el supervisor (goal-compass init)',
      );
    }
    return existing;
  }

  private async saveJournal(journal: Journal): Promise<void> {
    journal.updatedAt = new Date(this.clock.now()).toISOString();
    await this.journalPort.saveAtomically(journal);
  }
}

/** Compara el Goal del host con la intencion persistida. */
function matchesIntent(goal: GoalState, intent: TransitionIntent): boolean {
  if (goal.objective === intent.objective) return true;
  return normalize(goal.objective) === normalize(intent.objective);
}
