/**
 * El presupuesto como medida, no como muro.
 *
 * Un objetivo que se queda sin margen no es un trabajo descartado: es trabajo
 * a medias. Estos casos comprueban que vuelve a la cola con el doble de
 * presupuesto, hasta tres intentos, y que el presupuesto de la mision informa
 * en lugar de detener la cadena.
 */
import { describe, expect, it } from 'vitest';
import { decide, missionBudgetExceeded } from '../src/core/decide.js';
import {
  MAX_BUDGET_ATTEMPTS,
  candidateKey,
  type BudgetAttempt,
  type Candidate,
  type GoalState,
  type Journal,
} from '../src/core/types.js';
import { Supervisor } from '../src/supervisor.js';
import type { CandidatePort, Clock, Logger } from '../src/ports.js';
import {
  MemoryControl,
  MemoryGoalHost,
  MemoryJournal,
  aCandidate,
  aGoal,
  aMission,
  aSnapshot,
  anEmptyJournal,
  unCandado,
  MemoryGoalHistory,
} from './support/harness.js';

const NOW = 1_700_000_000_000;

const quietLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };
const fixedClock: Clock = { now: () => NOW };

/** Candidatos fijos: el nucleo no busca trabajo por su cuenta. */
class StaticCandidates implements CandidatePort {
  constructor(private readonly candidates: Candidate[]) {}
  async discover(): Promise<Candidate[]> {
    return this.candidates;
  }
}

function anAttempt(attempt: number, tokenBudget: number, goalId = 'tg_agotado_1'): BudgetAttempt {
  return {
    candidateKey: candidateKey(aCandidate()),
    candidateId: aCandidate().candidateId,
    goalId,
    attempt,
    tokenBudget,
    tokensUsed: tokenBudget,
    endedAt: NOW,
  };
}

function build(
  host: MemoryGoalHost,
  journal: MemoryJournal,
  candidates: Candidate[],
): Supervisor {
  return new Supervisor({
    goalPort: host,
    candidatePort: new StaticCandidates(candidates),
    journalPort: journal,
    historyPort: new MemoryGoalHistory(),
    chainLock: { acquire: () => unCandado() },
    controlPort: new MemoryControl(),
    clock: fixedClock,
    logger: quietLogger,
    pollIntervalMs: 1,
    parkedPollIntervalMs: 1,
    maxIterations: 1,
  });
}

/**
 * Un journal con un objetivo ya encadenado que se quedo sin presupuesto.
 *
 * Cada intento es un objetivo que la cadena creo, y el registro guarda uno por
 * intento: el que se agoto ahora y los que se agotaron antes. El trabajo se
 * aparta cuando ha tenido demasiados intentos, y para saber cuantos ha tenido
 * hay que contar los objetivos que se crearon, no solo los que se vio que se
 * quedaban sin margen.
 */
function journalWithExhaustedGoal(
  candidate: Candidate,
  options: { attempts?: BudgetAttempt[]; own?: boolean } = {},
): MemoryJournal {
  const journal = new MemoryJournal(anEmptyJournal(aMission({ defaultTokenBudget: 120_000 })));
  const attempts = options.attempts ?? [];
  journal.state.budgetAttempts = attempts;

  if (options.own !== false) {
    const intencion = (indice: number, goalId: string, tokenBudget: number) => ({
      intentId: `i${indice + 1}`,
      candidateId: candidate.candidateId,
      candidateKey: candidateKey(candidate),
      objective: candidate.objective,
      hostObjective: candidate.objective,
      evidenceRefs: [...candidate.evidenceRefs],
      doneWhen: [...candidate.doneWhen],
      tokenBudget,
      createdAt: new Date(NOW).toISOString(),
      status: 'committed' as const,
      goalId,
    });

    // Los intentos anteriores, cada uno con el margen que se le dio.
    attempts.forEach((attempt, indice) => {
      journal.state.intents.push(intencion(indice, attempt.goalId, attempt.tokenBudget));
    });
    // Y el que se agoto ahora, con el margen que le toco.
    journal.state.intents.push(
      intencion(
        attempts.length,
        goalIdOf(attempts.length),
        120_000 * 2 ** attempts.length,
      ),
    );
  }
  return journal;
}

/** Cada intento agotado es un objetivo distinto: el anterior se libero. */
function goalIdOf(previousAttempts: number): string {
  return `tg_agotado_${previousAttempts + 1}`;
}

/** El host tiene delante un objetivo agotado. */
function hostWithExhaustedGoal(candidate: Candidate, previousAttempts = 0): MemoryGoalHost {
  const host = new MemoryGoalHost();
  host.current = aGoal({
    goalId: goalIdOf(previousAttempts),
    objective: candidate.objective,
    status: 'budget_limited',
    tokenBudget: 120_000 * 2 ** previousAttempts,
    tokensUsed: 120_000 * 2 ** previousAttempts,
  });
  return host;
}

describe('nucleo · agotar el presupuesto no es un bloqueo', () => {
  const candidate = aCandidate();

  it('reintenta el trabajo agotado con el doble de margen', () => {
    const decision = decide(
      aSnapshot({
        goal: aGoal({ status: 'budget_limited', tokenBudget: 120_000, tokensUsed: 120_000 }),
        ownGoal: true,
        goalCandidate: candidate,
        goalCandidateKey: candidateKey(candidate),
        attempts: [
          {
            candidateKey: candidateKey(candidate),
            goalId: 'tg_agotado_1',
            tokenBudget: 120_000,
          },
        ],
      }),
    );

    expect(decision.kind).toBe('retry');
    if (decision.kind !== 'retry') return;
    expect(decision.tokenBudget).toBe(240_000);
    expect(decision.candidateKey).toBe(candidateKey(candidate));
  });

  it('el primer intento dobla el presupuesto que tenia el objetivo', () => {
    const decision = decide(
      aSnapshot({
        goal: aGoal({ status: 'budget_limited', tokenBudget: 120_000 }),
        ownGoal: true,
        goalCandidate: candidate,
        goalCandidateKey: candidateKey(candidate),
      }),
    );

    expect(decision.kind).toBe('retry');
    if (decision.kind !== 'retry') return;
    expect(decision.tokenBudget).toBe(240_000);
  });

  it('no toca el objetivo que no es de la cadena', () => {
    const decision = decide(
      aSnapshot({
        goal: aGoal({ status: 'budget_limited', tokenBudget: 120_000 }),
        ownGoal: false,
        goalCandidate: candidate,
      }),
    );

    expect(decision.kind).toBe('wait');
  });

  it('deja el trabajo para un humano cuando se agotan los intentos', () => {
    const attempts = [1, 2, 3].map((number) => anAttempt(number, 120_000 * 2 ** (number - 1)));
    const decision = decide(
      aSnapshot({
        goal: aGoal({ status: 'budget_limited', tokenBudget: 480_000 }),
        ownGoal: true,
        goalCandidate: candidate,
        goalCandidateKey: candidateKey(candidate),
        attempts: attempts.map((attempt) => ({
          candidateKey: attempt.candidateKey,
          goalId: attempt.goalId,
          tokenBudget: attempt.tokenBudget,
        })),
      }),
    );

    expect(decision.kind).toBe('park');
    expect(MAX_BUDGET_ATTEMPTS).toBe(3);
  });

  it('el presupuesto de la mision superado se mide pero no detiene la cadena', () => {
    const snapshot = aSnapshot({
      goal: aGoal({ status: 'complete' }),
      candidates: [candidate],
      mission: aMission({ totalTokenBudget: 10_000 }),
      tokensUsedTotal: 25_000,
    });

    expect(missionBudgetExceeded(snapshot)).toBe(true);
    expect(decide(snapshot).kind).toBe('create');
  });

  it('sin presupuesto declarado no hay nada que medir', () => {
    const snapshot = aSnapshot({
      goal: aGoal({ status: 'complete' }),
      mission: aMission({ totalTokenBudget: null }),
      tokensUsedTotal: 25_000,
    });

    expect(missionBudgetExceeded(snapshot)).toBe(false);
  });
});

describe('supervisor · el trabajo agotado vuelve a la cola', () => {
  const candidate = aCandidate();

  it('libera el objetivo agotado y encadena el mismo trabajo con mas margen', async () => {
    const host = hostWithExhaustedGoal(candidate);
    const journal = journalWithExhaustedGoal(candidate);
    const supervisor = build(host, journal, [candidate]);

    const outcome = await supervisor.step();

    expect(outcome.decision.kind).toBe('retry');
    expect(host.clearCount).toBe(1);
    expect(host.createCount).toBe(1);
    expect(host.grantedBudgets).toEqual([240_000]);

    // El intento agotado queda anotado con su coste.
    expect(journal.state.budgetAttempts).toHaveLength(1);
    expect(journal.state.budgetAttempts[0]?.attempt).toBe(1);
    expect(journal.state.budgetAttempts[0]?.tokenBudget).toBe(120_000);
    expect(journal.state.budgetAttempts[0]?.tokensUsed).toBe(120_000);

    // Es el mismo trabajo: la clave no cambia y la evidencia sigue puesta.
    const committed = journal.state.intents.filter((intent) => intent.status === 'committed');
    expect(committed).toHaveLength(2);
    expect(committed[1]?.candidateKey).toBe(candidateKey(candidate));
    expect(committed[1]?.evidenceRefs).toEqual(candidate.evidenceRefs);
    expect(committed[1]?.tokenBudget).toBe(240_000);
  });

  it('el reintento encadena un objetivo con la evidencia dentro', async () => {
    const host = hostWithExhaustedGoal(candidate);
    const journal = journalWithExhaustedGoal(candidate);
    const supervisor = build(host, journal, [candidate]);

    await supervisor.step();

    const created = host.current as GoalState;
    expect(created.objective).toContain(candidate.objective);
    expect(created.objective).toContain('Evidencia:');
    expect(created.objective).toContain('Criterio de cierre:');
  });

  it('el reintento reconstruye el trabajo desde el journal si ya no esta en la cola', async () => {
    // Entre el intento y el reintento el trabajo puede desaparecer de la cola:
    // se reordena el backlog, se cierra, se reescribe. El reintento tiene que
    // seguir siendo *el mismo* trabajo, con su evidencia y su criterio, y no uno
    // parecido que se parece en el titulo. Lo unico que queda de el es lo que
    // quedo escrito, asi que de ahi tiene que salir entero.
    const host = hostWithExhaustedGoal(candidate);
    const journal = journalWithExhaustedGoal(candidate);
    const supervisor = build(host, journal, []);

    const outcome = await supervisor.step();

    expect(outcome.decision.kind).toBe('retry');

    const created = host.current as GoalState;
    expect(created.objective).toContain(candidate.objective);
    expect(created.objective).toContain('Evidencia: docs/triage.md#parseo');
    expect(created.objective).toContain('Criterio de cierre:');
    expect(created.objective).toContain('La prueba que fallaba pasa');

    // Y la intencion nueva deja constancia de donde se saco, para el siguiente.
    const committed = journal.state.intents.filter((intent) => intent.status === 'committed');
    expect(committed[1]?.evidenceRefs).toEqual(candidate.evidenceRefs);
    expect(committed[1]?.doneWhen).toEqual(candidate.doneWhen);
  });

  it('el segundo intento agotado vuelve a la cola con el doble que el anterior', async () => {
    // El primer intento se quedo con 120k, este es el segundo (240k): el
    // siguiente se lleva 480k.
    const primerIntento = anAttempt(1, 120_000, 'tg_agotado_1');
    const host = hostWithExhaustedGoal(candidate, 1);
    const journal = journalWithExhaustedGoal(candidate, { attempts: [primerIntento] });
    const supervisor = build(host, journal, [candidate]);

    const outcome = await supervisor.step();

    expect(outcome.decision.kind).toBe('retry');
    expect(host.grantedBudgets).toEqual([480_000]);
    expect(journal.state.budgetAttempts).toHaveLength(2);
    expect(journal.state.budgetAttempts[1]?.attempt).toBe(2);
    expect(journal.state.budgetAttempts[1]?.tokenBudget).toBe(240_000);
  });

  it('cuando se agotan los intentos, la cadena espera y no crea nada', async () => {
    const attempts = [
      anAttempt(1, 120_000, 'tg_agotado_1'),
      anAttempt(2, 240_000, 'tg_agotado_2'),
    ];
    const host = hostWithExhaustedGoal(candidate, 2);
    const journal = journalWithExhaustedGoal(candidate, { attempts });
    const supervisor = build(host, journal, [candidate]);

    const outcome = await supervisor.step();

    expect(outcome.decision.kind).toBe('park');
    expect(host.createCount).toBe(0);
    expect(host.clearCount).toBe(0);
    expect(journal.state.budgetAttempts).toHaveLength(3);
  });

  it('no toca el objetivo agotado que no es de la cadena', async () => {
    const host = hostWithExhaustedGoal(candidate);
    const journal = journalWithExhaustedGoal(candidate, { own: false });
    const supervisor = build(host, journal, [candidate]);

    const outcome = await supervisor.step();

    expect(outcome.decision.kind).toBe('wait');
    expect(host.clearCount).toBe(0);
    expect(host.createCount).toBe(0);
    expect(journal.state.budgetAttempts).toHaveLength(0);
  });

  it('el gasto de la mision queda medido aunque se pase el presupuesto', async () => {
    const mission = aMission({ defaultTokenBudget: 120_000, totalTokenBudget: 10_000 });
    const host = hostWithExhaustedGoal(candidate);
    const journal = new MemoryJournal(anEmptyJournal(mission));
    journal.state.intents.push({
      intentId: 'i1',
      candidateId: candidate.candidateId,
      candidateKey: candidateKey(candidate),
      objective: candidate.objective,
      hostObjective: candidate.objective,
      evidenceRefs: [...candidate.evidenceRefs],
      doneWhen: [...candidate.doneWhen],
      tokenBudget: 120_000,
      createdAt: new Date(NOW).toISOString(),
      status: 'committed',
      goalId: goalIdOf(0),
    });
    const supervisor = build(host, journal, [candidate]);

    await supervisor.step();

    const state: Journal = journal.state;
    expect(state.metrics.budgetExceeded).toBe(true);
    expect(state.metrics.budgetExhaustions).toBe(1);
    expect(state.metrics.goalsCreated).toBe(2);
  });
});
