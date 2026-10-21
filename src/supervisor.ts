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
  BUDGET_EXHAUSTED_GOAL_STATUSES,
  TERMINAL_GOAL_STATUSES,
  candidateKey,
  composeObjective,
  normalize,
  normalizeJournal,
  type Candidate,
  type Decision,
  type GoalRecord,
  type GoalState,
  type Journal,
  type Mission,
  type Snapshot,
  type TransitionIntent,
} from './core/types.js';
import type {
  CandidatePort,
  ChainLockHandle,
  ChainLockPort,
  Clock,
  ExplorationPort,
  GoalPort,
  JournalPort,
  Logger,
} from './ports.js';

export interface SupervisorOptions {
  goalPort: GoalPort;
  candidatePort: CandidatePort;
  journalPort: JournalPort;
  /** Candado para encadenar: sin el, dos vias podrian crear a la vez. */
  chainLock: ChainLockPort;
  /** Canal de control del usuario, en un fichero aparte del journal. */
  controlPort: { read(): Promise<Mission['status'] | null> };
  clock: Clock;
  logger: Logger;
  /** Exploracion acotada cuando no hay trabajo elegible. */
  explorationPort?: ExplorationPort;
  /** Intervalo de sondeo mientras se espera (ms). */
  pollIntervalMs?: number;
  /** Intervalo de sondeo en estado parked (ms). */
  parkedPollIntervalMs?: number;
  /** Limite de iteraciones del bucle, como proteccion en pruebas. */
  maxIterations?: number;
  /** Fallos consecutivos tolerados antes de detener la cadena. */
  maxConsecutiveErrors?: number;
  /**
   * Texto que se anade al objetivo que recibe el host.
   *
   * El objetivo es lo unico que el host entrega al agente cuando encadena un
   * objetivo nuevo, asi que lo que el agente tiene que saber —como trabajar,
   * que no puede hacer, donde esta la mision— viaja aqui. Quien conduce la
   * mision decide que es eso; el supervisor solo lo coloca.
   */
  hostObjectiveAddon?: (journal: Journal, info: HostObjectiveContext) => string[];
}

/** Lo que quien conduce la mision sabe del objetivo que se va a encadenar. */
export interface HostObjectiveContext {
  /** El trabajo que se encadena. */
  candidate: Candidate;
  /** Si es el mismo trabajo reintentado tras quedarse sin presupuesto. */
  retried: boolean;
}

const DEFAULT_POLL_MS = 15_000;
const DEFAULT_PARKED_POLL_MS = 30_000;
const DEFAULT_MAX_CONSECUTIVE_ERRORS = 5;

/** Resultado de un paso del ciclo. */
export interface StepOutcome {
  decision: ReturnType<typeof decide>;
  /** El Goal creado en este paso, si lo hubo. */
  created?: GoalState;
}

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
  private readonly chainLock: ChainLockPort;
  private readonly controlPort: SupervisorOptions['controlPort'];
  private readonly explorationPort: ExplorationPort | undefined;
  private readonly clock: Clock;
  private readonly logger: Logger;
  private readonly pollIntervalMs: number;
  private readonly parkedPollIntervalMs: number;
  private readonly maxIterations: number | undefined;
  private readonly maxConsecutiveErrors: number;
  private readonly hostObjectiveAddon: SupervisorOptions['hostObjectiveAddon'];
  private readonly wakeSignal = new WakeSignal();
  private stopped = false;

  constructor(options: SupervisorOptions) {
    this.goalPort = options.goalPort;
    this.candidatePort = options.candidatePort;
    this.journalPort = options.journalPort;
    this.chainLock = options.chainLock;
    this.controlPort = options.controlPort;
    this.explorationPort = options.explorationPort;
    this.clock = options.clock;
    this.logger = options.logger;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_MS;
    this.parkedPollIntervalMs = options.parkedPollIntervalMs ?? DEFAULT_PARKED_POLL_MS;
    this.maxIterations = options.maxIterations;
    this.maxConsecutiveErrors = options.maxConsecutiveErrors ?? DEFAULT_MAX_CONSECUTIVE_ERRORS;
    this.hostObjectiveAddon = options.hostObjectiveAddon;
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

  /**
   * Avanza un paso del ciclo y devuelve lo que ha pasado.
   *
   * Es la misma logica que el bucle, pero sin esperas: un disparador externo
   * —un hook de plugin— decide en un instante y se retira. Cuando el paso
   * crea un Goal, ese Goal es el resultado.
   */
  async step(): Promise<StepOutcome> {
    const decision = await this.evaluate();
    this.logger.info(`decision: ${decision.kind} - ${decision.reason}`);
    const created = await this.execute(decision, { wait: false });
    return { decision, ...(created ? { created } : {}) };
  }

  private async execute(
    decision: ReturnType<typeof decide>,
    options: { wait: boolean } = { wait: true },
  ): Promise<GoalState | undefined> {
    switch (decision.kind) {
      case 'create':
        return this.executeCreate(decision.candidate);
      case 'retry':
        return this.executeRetry(decision.candidate, decision.candidateKey, decision.tokenBudget);
      case 'reconcile':
        await this.executeReconcile(decision.intent);
        return undefined;
      case 'park':
        await this.executePark(decision.reason, options.wait);
        return undefined;
      case 'wait':
        if (options.wait) await this.executeWait();
        return undefined;
      case 'escalate':
        await this.executeEscalate(decision.reason);
        return undefined;
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
    await this.recordBudgetExhaustion(journal, goal);
    await this.trackProgress(journal, goal);

    const discovered = await this.candidatePort.discover(journal.mission, goal);
    const candidates = [...discovered, ...journal.explored];
    const snapshot = this.buildSnapshot(journal, goal, candidates);
    await this.updateMetrics(journal, goal);

    const decision = decide(snapshot);
    await this.wakeIfAsleep(journal, decision);
    return decision;
  }

  /**
   * Despierta la mision cuando el motivo por el que se aparco ya no se cumple.
   *
   * Aparcar describe por que la cadena se callo **ahora**, no como es la mision.
   * Si el siguiente ciclo decide otra cosa —el objetivo vuelve a avanzar, o
   * aparece trabajo elegible— la razon guardada ya no explica nada, y el estado
   * se queda anunciando un bloqueo donde la cadena esta perfectamente sana.
   *
   * Solo la cadena aparca. Las pausas y las paradas son ordenes del usuario, y
   * un estado que el usuario puso no se levanta porque la cadena tenga ganas de
   * trabajar: para eso existe el orden de reanudar.
   */
  private async wakeIfAsleep(journal: Journal, decision: Decision): Promise<void> {
    if (journal.mission.status !== 'parked') return;
    if (decision.kind === 'park') return;

    journal.mission.status = 'running';
    journal.mission.reason = undefined;
    await this.saveJournal(journal);
    this.logger.info(`la mision vuelve a estar en marcha: ${decision.reason}`);
  }

  /**
   * Anota el ultimo avance del Goal en curso.
   *
   * La firma cambia cuando el objetivo cambia de estado, de turno o de tokens
   * consumidos. Mientras la firma no cambie, el objetivo esta estancado.
   */
  private async trackProgress(journal: Journal, goal: GoalState | null): Promise<void> {
    if (!goal) {
      if (journal.progress) {
        journal.progress = undefined;
        await this.saveJournal(journal);
      }
      return;
    }

    const signature = `${goal.status}|${goal.turnsUsed}|${goal.tokensUsed}`;
    if (journal.progress?.goalId === goal.goalId && journal.progress.signature === signature) {
      return;
    }

    journal.progress = { goalId: goal.goalId, signature, since: this.clock.now() };
    await this.saveJournal(journal);
  }

  private buildSnapshot(
    journal: Journal,
    goal: GoalState | null,
    candidates: Candidate[],
  ): Snapshot {
    // Un Goal ya terminado y registrado no se vuelve a sumar: contarlo dos
    // veces consumiria el presupuesto de la mision al doble de velocidad.
    // Y el Goal en curso solo cuenta si lo creo la cadena: el objetivo
    // nativo del usuario en su sesion no es gasto de esta mision.
    const recorded = new Set(journal.goals.map((record) => record.goalId));
    const own = goal ? this.isOwnGoal(journal, goal.goalId) : false;
    const tokensUsedTotal = this.tokensUsedTotal(journal, goal, recorded, own);

    const progress = journal.progress;
    const work = this.goalWork(journal, goal, candidates);
    return {
      mission: journal.mission,
      goal,
      candidates,
      pendingIntent: journal.intents.find((intent) => intent.status === 'intent') ?? null,
      completedGoalIds: journal.goals.map((record) => record.goalId),
      // Solo `complete` marca trabajo pagado. Un objetivo que se liquido
      // bloqueado o sin presupuesto sigue siendo trabajo pendiente: se puede
      // reintentar, desbloquear o volver a elegir, pero no se da por hecho.
      completedCandidateIds: journal.goals
        .filter((record) => record.status === 'complete')
        .map((record) => record.candidateId)
        .filter((id): id is string => typeof id === 'string'),
      completedCandidateKeys: journal.goals
        .filter((record) => record.status === 'complete')
        .map((record) => record.candidateKey)
        .filter((key): key is string => typeof key === 'string'),
      goalsCreated: journal.intents.filter((intent) => intent.status === 'committed').length,
      tokensUsedTotal,
      ownGoal: own,
      goalCandidate: work.candidate,
      goalCandidateKey: work.key,
      budgetAttempts: journal.budgetAttempts,
      goalProgressSince: progress && progress.goalId === goal?.goalId ? progress.since : null,
      now: this.clock.now(),
    };
  }

  /**
   * El trabajo que representa el objetivo en curso.
   *
   * Se busca el candidato vivo que encaja con la intencion; si ya no esta en
   * la cola, se reconstruye con lo que quedo guardado, porque el reintento
   * tiene que seguir siendo el mismo trabajo aunque la cola haya cambiado.
   */
  private goalWork(
    journal: Journal,
    goal: GoalState | null,
    candidates: Candidate[],
  ): { candidate: Candidate | null; key: string | null } {
    if (!goal) return { candidate: null, key: null };

    const intent = journal.intents.find((entry) => entry.goalId === goal.goalId);
    if (!intent) return { candidate: null, key: null };

    const live = candidates.find((candidate) => candidate.candidateId === intent.candidateId);
    return { candidate: live ?? candidateFromIntent(intent), key: intent.candidateKey };
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

  /** Registra en el journal un Goal liquidado, una sola vez por Goal. */
  private async syncCompletedGoal(journal: Journal, goal: GoalState | null): Promise<void> {
    if (!goal) return;
    // Cualquier desenlace terminal deja rastro, no solo `complete`. Cuando el
    // host liquida el objetivo en `blocked`, `paused` o `budget_limited` y no se
    // guarda nada, el trabajo queda sin marcar: la cadena vuelve a ofrecerlo y
    // aparece un objetivo nuevo para lo mismo, indefinidamente. Guardar el
    // estado —no aplanarlo a "hecho"— es lo que permite despues decidir si se
    // reintenta, se desbloquea o se cambia de tarea.
    if (!TERMINAL_GOAL_STATUSES.includes(goal.status)) return;
    if (journal.goals.some((record) => record.goalId === goal.goalId)) return;

    // Un objetivo que la cadena no creo no es trabajo de la mision: no se le
    // cobra su presupuesto ni cuenta como candidato ya resuelto. El objetivo
    // nativo que el usuario tenga en su sesion es suyo, y su gasto no es de
    // esta mision. Sin esto, declarar una mision en una sesion que ya
    // trabaja consume el presupuesto entero y la deja dormida al instante.
    const intent = journal.intents.find((entry) => entry.goalId === goal.goalId);
    if (!intent) {
      this.logger.info(`objetivo ajeno a la mision, no se contabiliza: ${goal.goalId}`);
      return;
    }

    const record: GoalRecord = {
      goalId: goal.goalId,
      objective: intent.objective,
      status: goal.status,
      statusReason: goal.statusReason,
      tokensUsed: goal.tokensUsed,
      turnsUsed: goal.turnsUsed,
      startedAt: goal.createdAt,
      endedAt: goal.updatedAt,
      candidateId: intent.candidateId,
      candidateKey: intent.candidateKey,
      evidenceRefs: intent.evidenceRefs ?? [],
      doneWhen: intent.doneWhen ?? [],
      receipt: goal.lastVerification?.reason?.slice(0, 200),
    };
    journal.goals.push(record);
    this.pruneExplored(journal);
    await this.saveJournal(journal);
    this.logger.info(
      `goal liquidado registrado: ${goal.goalId} en ${goal.status} (${goal.statusReason ?? 'sin motivo'})`,
    );
  }

  /** Si el objetivo lo creo la cadena, segun las intenciones persistidas. */
  private isOwnGoal(journal: Journal, goalId: string): boolean {
    return journal.intents.some((intent) => intent.goalId === goalId);
  }

  /**
   * Anota el intento que se quedo sin presupuesto.
   *
   * Solo cuenta el objetivo que creo la cadena: el objetivo nativo del usuario
   * es suyo, y su gasto no es de esta mision. Cada objetivo se anota una vez,
   * aunque se lo siga viendo en estado agotado.
   */
  private async recordBudgetExhaustion(journal: Journal, goal: GoalState | null): Promise<void> {
    if (!goal || !BUDGET_EXHAUSTED_GOAL_STATUSES.includes(goal.status)) return;
    if (!this.isOwnGoal(journal, goal.goalId)) return;
    if (journal.budgetAttempts.some((attempt) => attempt.goalId === goal.goalId)) return;

    const intent = journal.intents.find((entry) => entry.goalId === goal.goalId);
    const key = intent?.candidateKey ?? goal.goalId;
    const previous = journal.budgetAttempts.filter((attempt) => attempt.candidateKey === key);

    journal.budgetAttempts.push({
      candidateKey: key,
      candidateId: intent?.candidateId ?? key,
      goalId: goal.goalId,
      attempt: previous.length + 1,
      tokenBudget: goal.tokenBudget ?? intent?.tokenBudget ?? journal.mission.defaultTokenBudget,
      tokensUsed: goal.tokensUsed,
      endedAt: goal.updatedAt,
    });
    await this.saveJournal(journal);
    this.logger.warn(
      `objetivo ${goal.goalId} sin presupuesto (${goal.tokensUsed} token(s)): ` +
        'el mismo trabajo vuelve a la cola con mas margen',
    );
  }

  /**
   * Cuanto ha gastado la mision.
   *
   * Cuentan los objetivos terminados y los que se quedaron sin presupuesto:
   * esos tokens tambien se gastaron. Un Goal ya terminado y registrado no se
   * vuelve a sumar: contarlo dos veces consumiria el presupuesto de la mision
   * al doble de velocidad. Y el Goal en curso solo cuenta si lo creo la
   * cadena: el objetivo nativo del usuario en su sesion no es gasto de esta
   * mision.
   */
  private tokensUsedTotal(
    journal: Journal,
    goal: GoalState | null,
    recorded?: Set<string>,
    own?: boolean,
  ): number {
    const counted = recorded ?? new Set(journal.goals.map((record) => record.goalId));
    const attempted = new Set(journal.budgetAttempts.map((attempt) => attempt.goalId));
    const isOwn = own ?? (goal ? this.isOwnGoal(journal, goal.goalId) : false);

    const total =
      journal.goals.reduce((sum, record) => sum + record.tokensUsed, 0) +
      journal.budgetAttempts.reduce((sum, attempt) => sum + attempt.tokensUsed, 0);

    if (goal && isOwn && !counted.has(goal.goalId) && !attempted.has(goal.goalId)) {
      return total + goal.tokensUsed;
    }
    return total;
  }

  /**
   * Actualiza las medidas de la mision.
   *
   * El presupuesto total no detiene la cadena: se anota cuando se supera, para
   * que el gasto quede a la vista, y se avisa una sola vez al cruzarlo.
   */
  private async updateMetrics(journal: Journal, goal: GoalState | null): Promise<void> {
    const metrics = journal.metrics;
    const wasExceeded = metrics.budgetExceeded;
    const tokensUsed = this.tokensUsedTotal(journal, goal);
    const goalsCreated = journal.intents.filter((intent) => intent.status === 'committed').length;
    const budget = journal.mission.totalTokenBudget;
    const exceeded = budget !== null && tokensUsed >= budget;

    const changed =
      metrics.tokensUsed !== tokensUsed ||
      metrics.budgetExceeded !== exceeded ||
      metrics.budgetExhaustions !== journal.budgetAttempts.length ||
      metrics.goalsCreated !== goalsCreated;

    metrics.tokensUsed = tokensUsed;
    metrics.budgetExceeded = exceeded;
    metrics.budgetExhaustions = journal.budgetAttempts.length;
    metrics.goalsCreated = goalsCreated;

    if (!changed) return;
    await this.saveJournal(journal);

    if (exceeded && !wasExceeded) {
      this.logger.warn(
        `el presupuesto de la mision (${budget}) se ha superado (${tokensUsed} token(s)): ` +
          'la cadena sigue, el presupuesto es una medida',
      );
    }
  }

  /** Descarta los candidatos explorados que ya se han resuelto. */
  private pruneExplored(journal: Journal): void {
    if (journal.explored.length === 0) return;
    const done = new Set(journal.goals.map((record) => record.candidateKey));
    journal.explored = journal.explored.filter(
      (candidate) => !done.has(candidateKey(candidate)),
    );
  }

  // ---------------------------------------------------------------- ejecutar

  /**
   * Transicion durable: intencion -> creacion -> read-back -> commit.
   *
   * Devuelve el Goal confirmado, o `undefined` si no se pudo crear.
   */
  /** Si la valla sigue siendo nuestra. Sin candado no hay nada que comprobar. */
  private suyo(candado: ChainLockHandle | undefined): boolean {
    return candado === undefined || candado.valid();
  }

  private async executeCreate(candidate: Candidate): Promise<GoalState | undefined> {
    // Solo una via encadena a la vez. El cierre de turno del agente y el
    // sondeo del supervisor ven el objetivo terminado en el mismo instante:
    // sin este candado, los dos crearian el siguiente y uno se quedaria
    // huerfano con sus tokens gastados.
    const candado = this.chainLock.acquire(this.clock.now());
    if (!candado) {
      this.logger.info('otra via esta encadenando trabajo: se espera al siguiente ciclo');
      return undefined;
    }

    try {
      return await this.createGoal(candidate, {}, candado);
    } finally {
      candado();
    }
  }
  /**
   * Reintenta el trabajo que se quedo sin presupuesto.
   *
   * El host guarda un unico objetivo por sesion, y un objetivo agotado impide
   * crear el siguiente: primero se libera el hueco y luego se encadena el
   * mismo trabajo con el presupuesto doblado. Es el mismo trabajo y con la
   * misma evidencia: solo cambia cuanto margen tiene.
   */
  private async executeRetry(
    candidate: Candidate,
    candidateKey: string,
    tokenBudget: number,
  ): Promise<GoalState | undefined> {
    const candado = this.chainLock.acquire(this.clock.now());
    if (!candado) {
      this.logger.info('otra via esta encadenando trabajo: se espera al siguiente ciclo');
      return undefined;
    }

    try {
      const sessionId = this.goalPort.sessionId();
      const cleared = await this.goalPort.clear(sessionId);
      if (!cleared) {
        const current = await this.goalPort.read(sessionId);
        if (current) {
          this.logger.warn(
            `no se pudo liberar el objetivo ${current.goalId} (${current.status}): el reintento espera`,
          );
          return undefined;
        }
      }

      this.logger.info(
        `objetivo liberado: se reintenta "${candidate.objective}" con ${tokenBudget} token(s)`,
      );
      return await this.createGoal(candidate, { tokenBudget, candidateKey, retried: true }, candado);
    } finally {
      candado();
    }
  }

  /** Crea el objetivo: primero se comprueba que toca, luego se encadena. */
  private async createGoal(
    candidate: Candidate,
    options: { tokenBudget?: number; candidateKey?: string; retried?: boolean } = {},
    candado?: ChainLockHandle,
  ): Promise<GoalState | undefined> {
    // La valla se consulta justo antes de escribir, no al principio: entre una
    // cosa y otra esta la llamada al host, que es justo donde el candado se
    // puede perder. Un ejecutor que ya no lo tiene se retira sin tocar nada.
    if (!this.suyo(candado)) {
      this.logger.warn('el candado ya no es nuestro: no se escribe nada');
      return undefined;
    }

    const journal = await this.loadJournal();
    const sessionId = this.goalPort.sessionId();

    // Reconfirmar el estado antes de crear: solo un Goal terminado habilita.
    const current = await this.goalPort.read(sessionId);
    if (current && current.status !== 'complete') {
      this.logger.info(
        `creacion cancelada: el goal actual esta en "${current.status}", no en "complete"`,
      );
      return undefined;
    }

    const tokenBudget =
      options.tokenBudget ?? candidate.tokenBudget ?? journal.mission.defaultTokenBudget;
    // Al host se le da el objetivo con la evidencia y el criterio de cierre
    // dentro: el Goal se autoejecuta y su arranque solo lleva ese texto.
    const hostObjective = composeObjective(
      candidate,
      this.hostObjectiveAddon?.(journal, {
        candidate,
        retried: options.retried === true,
      }),
    );
    const intent: TransitionIntent = {
      intentId: randomUUID(),
      candidateId: candidate.candidateId,
      candidateKey: options.candidateKey ?? candidateKey(candidate),
      objective: candidate.objective,
      hostObjective,
      evidenceRefs: [...candidate.evidenceRefs],
      doneWhen: [...candidate.doneWhen],
      tokenBudget,
      createdAt: new Date(this.clock.now()).toISOString(),
      status: 'intent',
    };

    // La intencion se persiste antes de tocar el host: si el proceso muere
    // aqui, el reinicio sabra que hay que reconciliar.
    journal.intents.push(intent);
    // Encadenar trabajo es novedad: la mision vuelve a estar en marcha.
    journal.mission.status = 'running';
    journal.mission.reason = undefined;
    await this.saveJournal(journal);
    this.logger.info(`intencion persistida: ${candidate.candidateId} -> ${intent.intentId}`);

    let created: GoalState;
    try {
      created = await this.goalPort.create(sessionId, hostObjective, tokenBudget);
    } catch (err) {
      // La intencion sigue sin confirmar: se reconciliara en el proximo ciclo.
      this.logger.error(`la creacion del goal fallo: ${(err as Error).message}`);
      return undefined;
    }

    const readBack = await this.goalPort.read(sessionId);
    const confirmed = readBack?.goalId === created.goalId ? readBack : created;

    if (!this.suyo(candado)) {
      this.logger.warn(
        `el candado se perdio durante la creacion: la intencion ${intent.intentId} queda sin confirmar`,
      );
      return confirmed;
    }

    this.commitIntent(journal, intent.intentId, confirmed.goalId);
    await this.saveJournal(journal);
    // El objetivo nuevo ya cuenta: las medidas se refrescan para que no
    // empieces a ir un paso por detras.
    await this.updateMetrics(journal, confirmed);

    this.logger.info(
      `goal creado y confirmado: ${confirmed.goalId} (${confirmed.status}) - ${hostObjective.slice(0, 80)}`,
    );
    return confirmed;
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
  private async executePark(reason: string, wait: boolean): Promise<void> {
    const journal = await this.loadJournal();
    if (journal.mission.status !== 'parked') {
      journal.mission.status = 'parked';
      journal.mission.reason = reason;
      await this.saveJournal(journal);
      this.logger.info(`mision en parked: ${reason}`);
    }
    await this.tryExplore(journal);
    if (wait) await this.wakeSignal.wait(this.parkedPollIntervalMs);
  }

  /**
   * Pide una exploracion cuando no hay trabajo elegible, el objetivo esta
   * quieto y ya se enfrio la ultima consulta.
   *
   * Es acotada por diseno: una sola consulta por enfriamiento, y lo que
   * devuelve tiene que superar el filtro de candidatos. Si no aporta nada
   * real, la mision sigue dormida.
   */
  private async tryExplore(journal: Journal): Promise<void> {
    if (!this.explorationPort || !journal.mission.explorationEnabled) return;

    const goal = await this.goalPort.read(this.goalPort.sessionId());
    if (goal) return;

    const now = this.clock.now();
    const lastExploration = journal.lastExplorationAt ?? 0;
    if (now - lastExploration < this.explorationWait(journal)) return;

    journal.lastExplorationAt = now;
    await this.saveJournal(journal);
    this.logger.info('sin trabajo elegible: se pide una exploracion acotada del workspace');

    let proposals: Candidate[];
    try {
      proposals = await this.explorationPort.explore(journal.mission, null);
    } catch (err) {
      this.logger.error(`la exploracion fallo: ${(err as Error).message}`);
      return;
    }

    if (proposals.length === 0) {
      // Cada exploracion vacia aleja la siguiente: preguntar una y otra vez
      // lo mismo seria gastar sin obtener nada.
      journal.explorationStreak = Math.min((journal.explorationStreak ?? 0) + 1, 6);
      await this.saveJournal(journal);
      this.logger.info(
        `la exploracion no aporto trabajo real: la siguiente esperara ${Math.round(
          this.explorationWait(journal) / 60_000,
        )} minuto(s)`,
      );
      return;
    }

    journal.explored.push(...proposals);
    journal.explorationStreak = 0;
    journal.mission.status = 'running';
    journal.mission.reason = undefined;
    await this.saveJournal(journal);
    this.logger.info(`la exploracion aporto ${proposals.length} candidato(s): la mision continua`);
  }

  /** Espera antes de la siguiente exploracion: crece con las exploraciones vacias. */
  private explorationWait(journal: Journal): number {
    const factor = 2 ** Math.max(0, (journal.explorationStreak ?? 0) - 1);
    return journal.mission.explorationCooldownMs * factor;
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
    // Un journal escrito antes de que existieran los intentos y las medidas
    // se completa al leerlo: lo viejo sigue siendo utilizable.
    return normalizeJournal(existing);
  }

  private async saveJournal(journal: Journal): Promise<void> {
    journal.updatedAt = new Date(this.clock.now()).toISOString();
    await this.journalPort.saveAtomically(journal);
  }
}

/** Compara el Goal del host con la intencion persistida. */
function matchesIntent(goal: GoalState, intent: TransitionIntent): boolean {
  // El host recibio el objetivo con la evidencia dentro. Las intenciones
  // antiguas solo guardaban el texto del trabajo: se comparan con el.
  const expected = intent.hostObjective ?? intent.objective;
  if (goal.objective === expected) return true;
  return normalize(goal.objective) === normalize(expected);
}

/**
 * Reconstruye el trabajo de una intencion cuando ya no esta en la cola.
 *
 * Se conservan el objetivo, la evidencia y el criterio de cierre: el
 * reintento tiene que ser el mismo trabajo, no uno parecido.
 */
function candidateFromIntent(intent: TransitionIntent): Candidate {
  return {
    candidateId: intent.candidateId,
    objective: intent.objective,
    whyNow: 'el objetivo se quedo sin presupuesto y se reintenta con mas margen',
    evidenceRefs: [...(intent.evidenceRefs ?? [])],
    doneWhen: [...(intent.doneWhen ?? [])],
    risk: 'medium',
    priority: 0,
    prerequisites: [],
    source: 'roadmap',
    ...(intent.tokenBudget !== undefined ? { tokenBudget: intent.tokenBudget } : {}),
  };
}
