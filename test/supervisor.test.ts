import { describe, expect, it } from 'vitest';
import { Supervisor } from '../src/supervisor.js';
import type { Candidate, GoalState, Journal } from '../src/core/types.js';
import type { CandidatePort, Clock, ExplorationPort, Logger } from '../src/ports.js';
import {
  MemoryControl,
  MemoryGoalHost,
  MemoryJournal,
  aCandidate,
  aGoal,
  anEmptyJournal,
  aMission,
} from './support/harness.js';

const NOW = 1_700_000_000_000;

const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };
const fixedClock: Clock = { now: () => NOW };

class StaticCandidates implements CandidatePort {
  constructor(private readonly list: Candidate[]) {}
  async discover(): Promise<Candidate[]> {
    return this.list;
  }
}

/** Exploracion que devuelve siempre lo mismo y cuenta las consultas. */
class FakeExploration implements ExplorationPort {
  calls = 0;
  constructor(private readonly proposals: Candidate[]) {}
  async explore(): Promise<Candidate[]> {
    this.calls += 1;
    return this.proposals;
  }
}

interface Harness {
  supervisor: Supervisor;
  host: MemoryGoalHost;
  journal: MemoryJournal;
  control: MemoryControl;
}

function build(
  options: {
    host?: MemoryGoalHost;
    journal?: MemoryJournal;
    candidates?: Candidate[];
    control?: MemoryControl;
    explorationPort?: ExplorationPort;
    maxIterations?: number;
  } = {},
): Harness {
  const host = options.host ?? new MemoryGoalHost();
  const journal = options.journal ?? new MemoryJournal(anEmptyJournal());
  const control = options.control ?? new MemoryControl();
  const supervisor = new Supervisor({
    goalPort: host,
    candidatePort: new StaticCandidates(options.candidates ?? []),
    journalPort: journal,
    chainLock: { acquire: () => () => {} },
    controlPort: control,
    clock: fixedClock,
    logger: silentLogger,
    pollIntervalMs: 1,
    parkedPollIntervalMs: 1,
    maxIterations: options.maxIterations ?? 1,
    ...(options.explorationPort ? { explorationPort: options.explorationPort } : {}),
  });
  return { supervisor, host, journal, control };
}

function pendingIntent(journal: MemoryJournal, overrides: Partial<Journal['intents'][number]>): void {
  journal.state.intents.push({
    intentId: 'i1',
    candidateId: 'c1',
    candidateKey: 'clave-estable',
    objective: 'Corregir el fallo de parseo',
    tokenBudget: 100_000,
    createdAt: new Date(NOW).toISOString(),
    status: 'intent',
    ...overrides,
  });
}

describe('supervisor · transicion durable', () => {
  it('crea el primer Goal sin intervencion humana', async () => {
    const { supervisor, host, journal } = build({ candidates: [aCandidate()] });

    await supervisor.run();

    expect(host.createCount).toBe(1);
    expect(host.current?.objective).toBe('Corregir el fallo de parseo');
    expect(journal.state.intents[0]?.status).toBe('committed');
  });

  it('encadena el siguiente Goal cuando el anterior termina', async () => {
    const host = new MemoryGoalHost();
    host.current = aGoal({ goalId: 'tg_previo', status: 'complete' });
    const { supervisor, host: goalHost } = build({ host, candidates: [aCandidate()] });

    await supervisor.run();

    expect(goalHost.createCount).toBe(1);
    expect(goalHost.current?.goalId).toBe('tg_new_1');
  });

  it('no crea dos veces ante notificaciones repetidas', async () => {
    const host = new MemoryGoalHost();
    host.current = aGoal({ goalId: 'tg_previo', status: 'complete' });
    const { supervisor, host: goalHost } = build({
      host,
      candidates: [aCandidate()],
      maxIterations: 3,
    });

    await supervisor.run();

    expect(goalHost.createCount).toBe(1);
    const decisions = await Promise.all([supervisor.evaluate(), supervisor.evaluate()]);
    for (const decision of decisions) expect(decision.kind).not.toBe('create');
    expect(goalHost.createCount).toBe(1);
  });

  it('reconcilia un fallo entre creacion y commit sin duplicar', async () => {
    const host = new MemoryGoalHost();
    host.current = aGoal({
      goalId: 'tg_creado',
      objective: 'Corregir el fallo de parseo',
      status: 'active',
      statusReason: null,
    });
    const journal = new MemoryJournal(anEmptyJournal());
    pendingIntent(journal, { intentId: 'i-crash' });
    const { supervisor, host: goalHost } = build({ host, journal, candidates: [aCandidate()] });

    await supervisor.run();

    expect(goalHost.createCount).toBe(0);
    expect(journal.state.intents[0]?.status).toBe('committed');
    expect(journal.state.intents[0]?.goalId).toBe('tg_creado');
  });

  it('escala el conflicto cuando el Goal del host no es el de la intencion', async () => {
    const host = new MemoryGoalHost();
    host.current = aGoal({ goalId: 'tg_otro', objective: 'otra cosa', status: 'active' });
    const journal = new MemoryJournal(anEmptyJournal());
    pendingIntent(journal, { intentId: 'i-crash' });
    const { supervisor, host: goalHost } = build({ host, journal, candidates: [aCandidate()] });

    await supervisor.run();

    expect(goalHost.createCount).toBe(0);
    expect(journal.state.mission.status).toBe('escalated');
  });

  it('no crea Goal mientras el actual esta activo', async () => {
    const host = new MemoryGoalHost();
    host.current = aGoal({ goalId: 'tg_activo', status: 'active', statusReason: null });
    const { supervisor, host: goalHost } = build({ host, candidates: [aCandidate()] });

    await supervisor.run();

    expect(goalHost.createCount).toBe(0);
  });

  it('registra el Goal terminado y no vuelve a proponer el mismo candidato', async () => {
    const host = new MemoryGoalHost();
    host.current = aGoal({
      goalId: 'tg_hecho',
      objective: 'Corregir el fallo de parseo',
      status: 'complete',
    });
    const journal = new MemoryJournal(anEmptyJournal());
    pendingIntent(journal, { status: 'committed', goalId: 'tg_hecho' });
    const { supervisor, host: goalHost } = build({ host, journal, candidates: [aCandidate()] });

    await supervisor.run();

    expect(journal.state.goals.map((record) => record.goalId)).toContain('tg_hecho');
    expect(goalHost.createCount).toBe(0);
    expect(journal.state.mission.status).toBe('parked');
  });

  it('no crea Goal si el candidato carece de evidencia', async () => {
    const { supervisor, host, journal } = build({
      candidates: [aCandidate({ evidenceRefs: [] })],
    });

    await supervisor.run();

    expect(host.createCount).toBe(0);
    expect(journal.state.mission.status).toBe('parked');
  });
});

describe('supervisor · control del usuario', () => {
  it('pausa el Goal en curso para que deje de consumir', async () => {
    const host = new MemoryGoalHost();
    host.current = aGoal({ goalId: 'tg_activo', status: 'active', statusReason: null });
    const control = new MemoryControl();
    control.status = 'paused_by_user';
    const { supervisor, host: goalHost } = build({ host, control });

    await supervisor.run();

    expect(goalHost.pauseCount).toBe(1);
    expect(goalHost.current?.status).toBe('paused');
  });

  it('reanuda un Goal pausado cuando la mision vuelve a estar en marcha', async () => {
    const host = new MemoryGoalHost();
    host.current = aGoal({
      goalId: 'tg_pausado',
      status: 'paused',
      statusReason: 'paused(user_requested)',
    });
    const control = new MemoryControl();
    control.status = 'running';
    const { supervisor, host: goalHost } = build({ host, control });

    await supervisor.run();

    expect(goalHost.resumeCount).toBe(1);
    expect(goalHost.current?.status).toBe('active');
  });

  it('no crea Goals cuando el usuario detiene la mision', async () => {
    const control = new MemoryControl();
    control.status = 'stopped_by_user';
    const { supervisor, host } = build({ control, candidates: [aCandidate()] });

    await supervisor.run();

    expect(host.createCount).toBe(0);
  });
});

describe('supervisor · estancamiento', () => {
  it('anota el avance del objetivo y lo vuelve a anotar cuando cambia', async () => {
    const host = new MemoryGoalHost();
    host.current = aGoal({ goalId: 'tg_lento', status: 'active', statusReason: null });
    const { supervisor, journal } = build({ host, candidates: [aCandidate()] });

    await supervisor.run();

    const first = journal.state.progress;
    expect(first?.goalId).toBe('tg_lento');

    // El objetivo consume tokens: eso es avanzar, aunque el estado no cambie.
    host.current = { ...host.current!, tokensUsed: 5_000 };
    await supervisor.run();

    expect(journal.state.progress?.signature).toContain('5000');
    expect(journal.state.progress?.since).toBeGreaterThanOrEqual(first?.since ?? 0);
  });

  it('olvida el avance cuando ya no hay objetivo', async () => {
    const host = new MemoryGoalHost();
    host.current = aGoal({ goalId: 'tg_lento', status: 'active', statusReason: null });
    const { supervisor, journal } = build({ host, candidates: [aCandidate()] });

    await supervisor.run();
    expect(journal.state.progress).toBeDefined();

    host.current = null;
    await supervisor.run();

    expect(journal.state.progress).toBeUndefined();
  });
});

describe('supervisor · exploracion acotada', () => {
  it('pide una exploracion cuando no hay trabajo elegible y la mision continua', async () => {
    const exploration = new FakeExploration([aCandidate({ candidateId: 'propuesta' })]);
    const { supervisor, journal, host } = build({
      candidates: [],
      explorationPort: exploration,
      maxIterations: 2,
    });

    await supervisor.run();

    expect(exploration.calls).toBe(1);
    expect(journal.state.explored).toHaveLength(1);
    expect(journal.state.mission.status).toBe('running');
    expect(host.createCount).toBe(1);
  });

  it('la mision sigue dormida si la exploracion no aporta nada', async () => {
    const exploration = new FakeExploration([]);
    const { supervisor, journal } = build({ candidates: [], explorationPort: exploration });

    await supervisor.run();

    expect(exploration.calls).toBe(1);
    expect(journal.state.mission.status).toBe('parked');
    expect(journal.state.explorationStreak).toBe(1);
  });

  it('respeta el enfriamiento: no pregunta otra vez enseguida', async () => {
    const exploration = new FakeExploration([]);
    const { supervisor, journal } = build({ candidates: [], explorationPort: exploration });

    await supervisor.run();
    await supervisor.run();

    expect(exploration.calls).toBe(1);
    expect(journal.state.explorationStreak).toBe(1);
  });

  it('no explora mientras hay un objetivo en marcha', async () => {
    const host = new MemoryGoalHost();
    host.current = aGoal({ goalId: 'tg_activo', status: 'active', statusReason: null });
    const exploration = new FakeExploration([aCandidate()]);
    const { supervisor } = build({ host, candidates: [], explorationPort: exploration });

    await supervisor.run();

    expect(exploration.calls).toBe(0);
  });
});

describe('supervisor · presupuesto de la mision', () => {  it('deja la mision dormida cuando el presupuesto se agota', async () => {
    const mission = aMission({ totalTokenBudget: 1_000 });
    const journal = new MemoryJournal({
      ...anEmptyJournal(mission),
      goals: [
        {
          goalId: 'tg_1',
          objective: 'trabajo previo',
          status: 'complete',
          statusReason: 'complete(verifier_met)',
          tokensUsed: 1_000,
          turnsUsed: 1,
          startedAt: NOW - 1_000,
          endedAt: NOW,
          candidateId: 'c1',
          candidateKey: 'clave-estable',
          receipt: undefined,
        },
      ],
    });
    const { supervisor, host } = build({ journal, candidates: [aCandidate()] });

    await supervisor.run();

    expect(host.createCount).toBe(0);
    expect(journal.state.mission.status).toBe('parked');
  });

  it('sigue encadenando mientras quede presupuesto', async () => {
    const mission = aMission({ totalTokenBudget: 10_000 });
    const journal = new MemoryJournal({
      ...anEmptyJournal(mission),
      goals: [
        {
          goalId: 'tg_1',
          objective: 'trabajo previo',
          status: 'complete',
          statusReason: 'complete(verifier_met)',
          tokensUsed: 900,
          turnsUsed: 1,
          startedAt: NOW - 1_000,
          endedAt: NOW,
          candidateId: 'c0',
          candidateKey: 'otra-clave',
          receipt: undefined,
        },
      ],
    });
    const { supervisor, host } = build({ journal, candidates: [aCandidate()] });

    await supervisor.run();

    expect(host.createCount).toBe(1);
  });

  it('no cuenta dos veces el Goal que ya esta registrado', async () => {
    const mission = aMission({ totalTokenBudget: 70_000 });
    const host = new MemoryGoalHost();
    host.current = aGoal({
      goalId: 'tg_registrado',
      objective: 'trabajo ya terminado',
      status: 'complete',
      tokensUsed: 60_000,
    });
    const journal = new MemoryJournal({
      ...anEmptyJournal(mission),
      goals: [
        {
          goalId: 'tg_registrado',
          objective: 'trabajo ya terminado',
          status: 'complete',
          statusReason: 'complete(verifier_met)',
          tokensUsed: 60_000,
          turnsUsed: 1,
          startedAt: NOW - 1_000,
          endedAt: NOW,
          candidateId: 'c0',
          candidateKey: 'otra-clave',
          receipt: undefined,
        },
      ],
    });
    const { supervisor, host: goalHost } = build({ host, journal, candidates: [aCandidate()] });

    // 60 000 reales, no 120 000: queda presupuesto y la cadena puede seguir.
    await supervisor.run();

    expect(goalHost.createCount).toBe(1);
  });
});
