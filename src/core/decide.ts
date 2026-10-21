/**
 * Nucleo puro: `Snapshot -> Decision`.
 *
 * Sin efectos, sin I/O, sin reloj propio (el tiempo llega en el snapshot).
 * Toda la politica de autoridad vive aqui; los adaptadores solo ejecutan.
 */
import {
  BUDGET_EXHAUSTED_GOAL_STATUSES,
  MAX_BUDGET_ATTEMPTS,
  NON_SUCCESS_GOAL_STATUSES,
  candidateKey,
  type Candidate,
  type Decision,
  type GoalState,
  type Mission,
  type Snapshot,
} from './types.js';

/** Por que un candidato no es elegible. */
export interface Rejection {
  candidateId: string;
  reason:
    | 'sin-evidencia'
    | 'sin-criterio-observable'
    | 'ya-completado'
    | 'duplicado-por-clave'
    | 'prerrequisito-pendiente';
  detail?: string;
}

/**
 * Que le falta a un candidato para poder convertirse en trabajo.
 *
 * Son las dos condiciones que no dependen del historial: un candidato sin
 * evidencia o sin criterio de cierre no es trabajo, hoy ni nunca. El nucleo
 * las aplica al decidir, y las fuentes de trabajo las comprueban antes de
 * ofrecer un candidato, para no prometer trabajo que luego se descarta.
 *
 * La tercera, `ya-completado`, depende del historial: es la que impide
 * ofrecer otra vez un trabajo que ya está pagado.
 */
export type CandidateDefect =
  | 'sin-evidencia'
  | 'sin-criterio-observable'
  | 'ya-completado';

/**
 * Comprueba si un candidato cumple las condiciones minimas para ser trabajo.
 *
 * Devuelve el motivo del descarte o `null` cuando el candidato es utilizable.
 */
export function candidateDefect(candidate: Candidate): CandidateDefect | null {
  if (candidate.evidenceRefs.length === 0) return 'sin-evidencia';
  if (candidate.doneWhen.length === 0) return 'sin-criterio-observable';
  return null;
}

const RISK_ORDER: Record<Candidate['risk'], number> = { low: 0, medium: 1, high: 2 };

/**
 * Concilia lo que la declaración dice con lo que el estado ya sabe.
 *
 * El journal guarda **dónde estamos**; la declaración es **qué hay que hacer**.
 * Son dos hechos distintos y por eso viven en sitios distintos: el journal está
 * fuera del repositorio porque es estado de ejecución, y la declaración está
 * dentro porque es la intención de quien la escribe.
 *
 * Sin esto, el backlog se congela: `openMission` tomaba la misión del journal
 * y la declaración no volvía a leerse nunca, así que añadir, repriorizar o
 * dividir trabajo no llegaba ni al estado ni a la cadena. La cadena seguía
 * encadenando el trabajo del día en que se creó el journal.
 *
 * La regla es de una línea: **la intención manda, el estado se conserva**. Lo
 * declarado describe el trabajo; lo guardado describe la situación. Y el estado
 * nunca se pisa desde la declaración, porque ahí vive la orden explícita del
 * usuario: una misión pausada a propósito no se reactiva porque el fichero
 * declare más trabajo.
 */
export function reconcileMission(declared: Mission, stored: Mission): Mission {
  return {
    ...declared,
    status: stored.status,
    reason: stored.reason,
    driver: stored.driver ?? declared.driver,
    driverAt: stored.driverAt ?? declared.driverAt,
  };
}

/**
 * Decide la siguiente accion a partir del estado observable.
 *
 * Reglas, en orden de precedencia:
 *  1. La autoridad del usuario gana siempre (stopped/paused_by_user).
 *  2. Una intencion sin confirmar se reconcilia ANTES de decidir nada nuevo.
 *  3. Un objetivo sin presupuesto es trabajo a medias: se reintenta con el
 *     presupuesto doblado, hasta tres intentos. No es un veredicto sobre el
 *     trabajo, asi que no se esquiva esperando.
 *  4. Los limites del host que no son de presupuesto (paused/blocked) se
 *     esperan: son una decision de alguien.
 *  5. Con un Goal `active` no se crea otro.
 *  6. Solo `complete` (o la ausencia de Goal) habilita crear el siguiente.
 *  7. El presupuesto total de la mision es una medida, no un muro: se informa
 *     en las metricas y la cadena sigue.
 */
export function decide(snapshot: Snapshot): Decision {
  const { mission, goal } = snapshot;

  if (mission.status === 'stopped_by_user') {
    return { kind: 'wait', reason: 'mision detenida por el usuario' };
  }
  if (mission.status === 'paused_by_user') {
    return { kind: 'wait', reason: 'mision pausada por el usuario' };
  }

  if (snapshot.pendingIntent) {
    return {
      kind: 'reconcile',
      intent: snapshot.pendingIntent,
      reason: 'intencion de transicion persistida sin confirmar: hay que reconciliar con el host',
    };
  }

  // Antes que el estancamiento: un objetivo sin presupuesto no avanza por si
  // mismo, y esperar a que expire el plazo seria dejar el trabajo a medias.
  if (goal && BUDGET_EXHAUSTED_GOAL_STATUSES.includes(goal.status)) {
    return decideRetry(snapshot, goal);
  }

  // Con un objetivo activo no se crea otro: sigue trabajando. Un objetivo
  // lento no es un objetivo parado —una compilacion larga o un test sin salida
  // son actividad legitima—, y aparcar la mision por eso apaga trabajo que si
  // avanza.
  if (goal && goal.status === 'active') {
    return { kind: 'wait', reason: 'goal activo: esperando a que termine' };
  }

  if (mission.maxGoals !== null && snapshot.goalsCreated >= mission.maxGoals) {
    return {
      kind: 'park',
      reason: `limite administrativo de ${mission.maxGoals} Goals alcanzado; la mision sigue viva`,
    };
  }

  const { eligible, rejected } = selectCandidates(snapshot);

  // Un objetivo **bloqueado** no apaga la mision. Si hay frontera ejecutable,
  // se sigue por otro lado: con la cola llena, esperar es la forma mas cara de
  // perder un ciclo. El objetivo bloqueado queda registrado en el journal y su
  // dependencia, anotada, para que la recuperacion lo encuentre despues.
  //
  // Solo `blocked`. Ni `paused` ni los estados de cuota se esquivan: pausar es
  // decision de alguien y `budget_limited` es un limite real del host, asi que
  // ambos siguen esperando —la cuota tiene su propia via, el reintento con mas
  // presupuesto y tres intentos—. Cambiar de tarea no puede ser la manera de
  // rodear un limite.
  if (goal && goal.status === 'blocked' && eligible.length > 0) {
    const siguiente = eligible[0]!;
    return {
      kind: 'create',
      candidate: siguiente,
      reason:
        `el objetivo ${goal.goalId} esta bloqueado y no avanza; ` +
        `se continua con otro trabajo de la frontera: ${siguiente.objective}`,
    };
  }

  if (goal && goal.status !== 'complete' && isStalled(snapshot)) {
    return {
      kind: 'park',
      reason:
        `el objetivo ${goal.goalId} lleva ${describeStall(snapshot)} en estado ${goal.status} sin avanzar; ` +
        'la mision sigue viva y espera a que alguien lo revise',
    };
  }

  if (goal && NON_SUCCESS_GOAL_STATUSES.includes(goal.status)) {
    const reason = goal.statusReason ? ` (${goal.statusReason})` : '';
    return {
      kind: 'wait',
      reason: `goal en estado ${goal.status}${reason}: se espera, es una decision de alguien y la cadena no la esquiva`,
    };
  }

  if (eligible.length === 0) {
    const blocked = rejected.filter((r) => r.reason === 'prerrequisito-pendiente');
    const detail =
      rejected.length === 0
        ? 'no hay candidatos registrados'
        : `${rejected.length} candidato(s) descartado(s)` +
          (blocked.length > 0
            ? `, ${blocked.length} por prerrequisitos pendientes (${blocked
                .map((b) => `${b.candidateId}: ${b.detail ?? '?'}`)
                .join('; ')})`
            : '');
    return {
      kind: 'park',
      reason: `${goal?.status === 'complete' ? 'goal completado y ' : ''}sin trabajo elegible: ${detail}`,
    };
  }

  const best = eligible[0]!;
  return {
    kind: 'create',
    candidate: best,
    reason: best.whyNow || `candidato elegido por prioridad (${best.priority})`,
  };
}

/**
 * Que hacer con un objetivo que se quedo sin margen.
 *
 * Agotar el presupuesto no dice nada del trabajo: solo dice que se le
 * acabo el espacio. Por eso el trabajo vuelve a la cola con el doble de
 * presupuesto, hasta un maximo de intentos. Cuando se agotan los intentos, la
 * mision sigue viva y espera a que alguien lo revise.
 */
function decideRetry(snapshot: Snapshot, goal: GoalState): Decision {
  if (!snapshot.ownGoal) {
    return {
      kind: 'wait',
      reason: `el objetivo ${goal.goalId} se quedo sin presupuesto y no es de la cadena: no se toca`,
    };
  }

  const candidate = snapshot.goalCandidate;
  if (!candidate) {
    return {
      kind: 'park',
      reason:
        `el objetivo ${goal.goalId} se quedo sin presupuesto y no se sabe que trabajo representa; ` +
        'la mision sigue viva',
    };
  }

  const key = snapshot.goalCandidateKey ?? candidateKey(candidate);
  const attempts = snapshot.budgetAttempts.filter((attempt) => attempt.candidateKey === key);

  if (attempts.length >= MAX_BUDGET_ATTEMPTS) {
    return {
      kind: 'park',
      reason:
        `el trabajo "${candidate.objective}" se quedo sin presupuesto ${attempts.length} veces ` +
        `(${attempts.map((attempt) => attempt.tokenBudget).join(', ')} token(s)); ` +
        'la mision sigue viva y espera a que alguien lo revise',
    };
  }

  const last = attempts[attempts.length - 1];
  const granted =
    last?.tokenBudget ??
    goal.tokenBudget ??
    candidate.tokenBudget ??
    snapshot.mission.defaultTokenBudget;

  return {
    kind: 'retry',
    candidate,
    candidateKey: key,
    tokenBudget: granted * 2,
    reason:
      `el objetivo ${goal.goalId} se quedo sin presupuesto (${goal.tokensUsed} de ${granted} token(s)); ` +
      `el mismo trabajo se reintenta con ${granted * 2}`,
  };
}

/**
 * Si el presupuesto declarado de la mision se ha superado.
 *
 * No detiene la cadena: el presupuesto mide lo que ha costado el trabajo, y
 * medir no es impedir. Se informa para que el gasto quede a la vista.
 */
export function missionBudgetExceeded(snapshot: Snapshot): boolean {
  const budget = snapshot.mission.totalTokenBudget;
  if (budget === null) return false;
  return snapshot.tokensUsedTotal >= budget;
}

/**
 * El Goal esta estancado cuando lleva demasiado tiempo sin avanzar de verdad.
 *
 * "Avanzar" significa cambiar de estado, de turno o de tokens consumidos: un
 * objetivo que sigue trabajando no esta estancado por el mero paso del tiempo.
 */
function isStalled(snapshot: Snapshot): boolean {
  if (snapshot.goalProgressSince === null) return false;
  return snapshot.now - snapshot.goalProgressSince > snapshot.mission.stallTimeoutMs;
}

/** Cuanto tiempo lleva el objetivo sin avanzar, en texto legible. */
function describeStall(snapshot: Snapshot): string {
  const elapsed = snapshot.now - (snapshot.goalProgressSince ?? snapshot.now);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return 'unos segundos';
  if (minutes < 60) return `${minutes} minuto(s)`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hora(s)`;
}

/**
 * Filtra y ordena candidatos de forma determinista.
 *
 * Rechaza: sin evidencia, sin criterio observable, ya completados, duplicados
 * por clave estable y con prerrequisitos no satisfechos.
 */
export function selectCandidates(snapshot: Snapshot): {
  eligible: Candidate[];
  rejected: Rejection[];
} {
  const completedIds = new Set(snapshot.completedCandidateIds);
  const completedKeys = new Set(snapshot.completedCandidateKeys);
  const keyById = new Map(snapshot.candidates.map((c) => [c.candidateId, candidateKey(c)]));

  const eligible: Candidate[] = [];
  const rejected: Rejection[] = [];

  for (const candidate of snapshot.candidates) {
    const defect = candidateDefect(candidate);
    if (defect) {
      rejected.push({ candidateId: candidate.candidateId, reason: defect });
      continue;
    }
    if (completedIds.has(candidate.candidateId)) {
      rejected.push({ candidateId: candidate.candidateId, reason: 'ya-completado' });
      continue;
    }
    if (completedKeys.has(candidateKey(candidate))) {
      rejected.push({ candidateId: candidate.candidateId, reason: 'duplicado-por-clave' });
      continue;
    }

    const pending = candidate.prerequisites.filter((prereq) => {
      if (completedIds.has(prereq)) return false;
      const prereqKey = keyById.get(prereq);
      return !(prereqKey !== undefined && completedKeys.has(prereqKey));
    });
    if (pending.length > 0) {
      rejected.push({
        candidateId: candidate.candidateId,
        reason: 'prerrequisito-pendiente',
        detail: pending.join(', '),
      });
      continue;
    }

    eligible.push(candidate);
  }

  eligible.sort(compareCandidates(snapshot));
  return { eligible, rejected };
}

/**
 * Orden determinista: prioridad desc, riesgo asc, coste asc, candidateId asc.
 * El desempate final por `candidateId` garantiza estabilidad total.
 */
function compareCandidates(snapshot: Snapshot): (a: Candidate, b: Candidate) => number {
  const budgetOf = (c: Candidate): number =>
    c.tokenBudget ?? snapshot.mission.defaultTokenBudget;

  return (a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    const risk = RISK_ORDER[a.risk] - RISK_ORDER[b.risk];
    if (risk !== 0) return risk;
    const cost = budgetOf(a) - budgetOf(b);
    if (cost !== 0) return cost;
    return a.candidateId.localeCompare(b.candidateId);
  };
}
