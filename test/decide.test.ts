import { describe, expect, it } from 'vitest';
import { decide, selectCandidates } from '../src/core/decide.js';
import { aCandidate, aGoal, aMission, aSnapshot } from './support/harness.js';

describe('decide · nucleo puro', () => {
  it('crea el primer Goal cuando no hay ninguno y hay candidatos', () => {
    expect(decide(aSnapshot({ candidates: [aCandidate()] })).kind).toBe('create');
  });

  it('encadena el siguiente Goal despues de que el anterior termina', () => {
    const decision = decide(
      aSnapshot({
        goal: aGoal({ status: 'complete' }),
        candidates: [aCandidate()],
        completedGoalIds: ['tg_1'],
      }),
    );
    expect(decision.kind).toBe('create');
  });

  it('no crea nada mientras el Goal sigue activo', () => {
    const decision = decide(
      aSnapshot({ goal: aGoal({ status: 'active' }), candidates: [aCandidate()] }),
    );
    expect(decision.kind).toBe('wait');
  });

  it.each(['paused', 'blocked', 'budget_limited', 'usage_limited'] as const)(
    'no esquiva el limite %s creando otro Goal',
    (status) => {
      const decision = decide(
        aSnapshot({ goal: aGoal({ status }), candidates: [aCandidate()] }),
      );
      expect(decision.kind).toBe('wait');
    },
  );

  it('deja la mision dormida cuando no hay candidatos', () => {
    const decision = decide(aSnapshot({ goal: aGoal({ status: 'complete' }), candidates: [] }));
    expect(decision.kind).toBe('park');
  });

  it('reconcilia una intencion sin confirmar antes de decidir nada nuevo', () => {
    const decision = decide(
      aSnapshot({
        goal: aGoal({ status: 'active' }),
        candidates: [aCandidate()],
        pendingIntent: {
          intentId: 'i1',
          candidateId: 'c1',
          candidateKey: 'k1',
          objective: 'objetivo',
          hostObjective: 'objetivo',
          evidenceRefs: [],
          doneWhen: [],
          tokenBudget: 1_000,
          createdAt: '2026-01-01T00:00:00.000Z',
          status: 'intent',
        },
      }),
    );
    expect(decision.kind).toBe('reconcile');
  });

  it('respeta la autoridad del usuario por encima del estado del Goal', () => {
    const decision = decide(
      aSnapshot({
        goal: aGoal({ status: 'complete' }),
        candidates: [aCandidate()],
        mission: aMission({ status: 'paused_by_user' }),
      }),
    );
    expect(decision.kind).toBe('wait');
  });

  it('respeta el limite administrativo de Goals', () => {
    const decision = decide(
      aSnapshot({
        goal: aGoal({ status: 'complete' }),
        candidates: [aCandidate()],
        mission: aMission({ maxGoals: 2 }),
        goalsCreated: 2,
      }),
    );
    expect(decision.kind).toBe('park');
  });

  it('sigue encadenando aunque el presupuesto de la mision se haya superado', () => {
    // El presupuesto mide lo que ha costado el trabajo; medir no es impedir.
    const decision = decide(
      aSnapshot({
        goal: aGoal({ status: 'complete' }),
        candidates: [aCandidate()],
        mission: aMission({ totalTokenBudget: 10_000 }),
        tokensUsedTotal: 10_000,
      }),
    );
    expect(decision.kind).toBe('create');
  });

  it('sigue encadenando mientras queda presupuesto de mision', () => {
    const decision = decide(
      aSnapshot({
        goal: aGoal({ status: 'complete' }),
        candidates: [aCandidate()],
        mission: aMission({ totalTokenBudget: 10_000 }),
        tokensUsedTotal: 9_999,
      }),
    );
    expect(decision.kind).toBe('create');
  });

  it('espera mientras el objetivo sigue avanzando', () => {
    const decision = decide(
      aSnapshot({
        goal: aGoal({ status: 'active' }),
        candidates: [aCandidate()],
        mission: aMission({ stallTimeoutMs: 60_000 }),
        goalProgressSince: 1_699_999_990_000,
        now: 1_700_000_000_000,
      }),
    );
    expect(decision.kind).toBe('wait');
  });

  it('da la mision por estancada cuando el objetivo no avanza', () => {
    const decision = decide(
      aSnapshot({
        goal: aGoal({ status: 'active' }),
        candidates: [aCandidate()],
        mission: aMission({ stallTimeoutMs: 60_000 }),
        goalProgressSince: 1_699_999_000_000,
        now: 1_700_000_000_000,
      }),
    );
    expect(decision.kind).toBe('park');
    expect(decision.reason).toContain('sin avanzar');
  });

  it('detecta el estancamiento tambien en un objetivo bloqueado', () => {
    const decision = decide(
      aSnapshot({
        goal: aGoal({ status: 'blocked' }),
        mission: aMission({ stallTimeoutMs: 60_000 }),
        goalProgressSince: 1_699_999_000_000,
        now: 1_700_000_000_000,
      }),
    );
    expect(decision.kind).toBe('park');
    expect(decision.reason).toContain('blocked');
  });
});

describe('selectCandidates · elegibilidad y deduplicacion', () => {
  it('rechaza candidatos sin evidencia', () => {
    const { eligible, rejected } = selectCandidates(
      aSnapshot({ candidates: [aCandidate({ evidenceRefs: [] })] }),
    );
    expect(eligible).toHaveLength(0);
    expect(rejected[0]?.reason).toBe('sin-evidencia');
  });

  it('rechaza candidatos sin criterio observable', () => {
    const { eligible, rejected } = selectCandidates(
      aSnapshot({ candidates: [aCandidate({ doneWhen: [] })] }),
    );
    expect(eligible).toHaveLength(0);
    expect(rejected[0]?.reason).toBe('sin-criterio-observable');
  });

  it('deduplica por intencion y alcance, no por texto literal', () => {
    const original = aCandidate({ candidateId: 'c1' });
    const reformulated = aCandidate({
      candidateId: 'c1-bis',
      objective: '  Corregir   el fallo de parseo  ',
      evidenceRefs: ['otra/evidencia.md'],
    });

    const first = selectCandidates(
      aSnapshot({ candidates: [original], completedCandidateKeys: [keyOf(original)] }),
    );
    expect(first.eligible).toHaveLength(0);

    const second = selectCandidates(
      aSnapshot({ candidates: [reformulated], completedCandidateKeys: [keyOf(original)] }),
    );
    expect(second.eligible).toHaveLength(0);
  });

  it('un candidato con prerrequisito pendiente no es elegible', () => {
    const { eligible, rejected } = selectCandidates(
      aSnapshot({ candidates: [aCandidate({ prerequisites: ['prev'] })] }),
    );
    expect(eligible).toHaveLength(0);
    expect(rejected[0]?.reason).toBe('prerrequisito-pendiente');
  });

  it('un candidato cuyo prerrequisito ya se completo si es elegible', () => {
    const { eligible } = selectCandidates(
      aSnapshot({
        candidates: [aCandidate({ prerequisites: ['prev'] })],
        completedCandidateIds: ['prev'],
      }),
    );
    expect(eligible).toHaveLength(1);
  });

  it('ordena por prioridad, riesgo, coste y candidato', () => {
    const { eligible } = selectCandidates(
      aSnapshot({
        candidates: [
          aCandidate({ candidateId: 'b', priority: 5 }),
          aCandidate({ candidateId: 'a', priority: 10 }),
          aCandidate({ candidateId: 'c', priority: 10, risk: 'high' }),
        ],
      }),
    );
    expect(eligible.map((candidate) => candidate.candidateId)).toEqual(['a', 'c', 'b']);
  });
});

function keyOf(candidate: ReturnType<typeof aCandidate>): string {
  return [
    candidate.objective.trim().toLowerCase().replace(/\s+/g, ' '),
    (candidate.scope ?? '').trim().toLowerCase(),
    candidate.doneWhen.map((item) => item.trim().toLowerCase()).sort().join('|'),
  ].join('::');
}
