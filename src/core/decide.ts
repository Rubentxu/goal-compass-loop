/**
 * Nucleo puro: `Snapshot -> Decision`.
 *
 * Sin efectos, sin I/O, sin reloj propio (el tiempo llega en el snapshot).
 * Toda la politica de autoridad vive aqui; los adaptadores solo ejecutan.
 */
import {
  NON_SUCCESS_GOAL_STATUSES,
  candidateKey,
  type Candidate,
  type Decision,
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

const RISK_ORDER: Record<Candidate['risk'], number> = { low: 0, medium: 1, high: 2 };

/**
 * Decide la siguiente accion a partir del estado observable.
 *
 * Reglas, en orden de precedencia:
 *  1. La autoridad del usuario gana siempre (stopped/paused_by_user).
 *  2. Una intencion sin confirmar se reconcilia ANTES de decidir nada nuevo.
 *  3. Los limites del host (paused/blocked/budget_limited/usage_limited) nunca
 *     se esquivan creando otro Goal.
 *  4. Con un Goal `active` no se crea otro.
 *  5. Solo `complete` (o la ausencia de Goal) habilita crear el siguiente.
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

  if (goal && NON_SUCCESS_GOAL_STATUSES.includes(goal.status)) {
    const reason = goal.statusReason ? ` (${goal.statusReason})` : '';
    return {
      kind: 'wait',
      reason: `goal en estado ${goal.status}${reason}: no se crea otro Goal para esquivar el limite`,
    };
  }

  if (goal && goal.status === 'active') {
    return { kind: 'wait', reason: 'goal activo: esperando a que termine' };
  }

  if (mission.maxGoals !== null && snapshot.goalsCreated >= mission.maxGoals) {
    return {
      kind: 'park',
      reason: `limite administrativo de ${mission.maxGoals} Goals alcanzado; la mision sigue viva`,
    };
  }

  if (mission.totalTokenBudget !== null && snapshot.tokensUsedTotal >= mission.totalTokenBudget) {
    return {
      kind: 'park',
      reason:
        `presupuesto de la mision agotado ` +
        `(${snapshot.tokensUsedTotal} de ${mission.totalTokenBudget} tokens); la mision sigue viva`,
    };
  }

  const { eligible, rejected } = selectCandidates(snapshot);

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
    if (candidate.evidenceRefs.length === 0) {
      rejected.push({ candidateId: candidate.candidateId, reason: 'sin-evidencia' });
      continue;
    }
    if (candidate.doneWhen.length === 0) {
      rejected.push({ candidateId: candidate.candidateId, reason: 'sin-criterio-observable' });
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
