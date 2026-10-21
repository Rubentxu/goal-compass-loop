/**
 * Todo objetivo que termina deja rastro, no solo el que termina en `complete`.
 *
 * El caso que duele: el host liquida un objetivo en un estado terminal que no es
 * `complete` —`blocked`, `paused`, `budget_limited`— y el journal no guarda
 * nada. El candidato sigue sin marcar como hecho ni como intentado, la cadena
 * vuelve a ofrecerlo y aparece un objetivo nuevo para el mismo trabajo. Asi es
 * como la misma candidata se encadena tres veces y la mision gasta el presupuesto
 * repitiendo algo que ya esta resuelto.
 */
import { describe, expect, it } from 'vitest';
import { Supervisor } from '../src/supervisor.js';
import type { Candidate, GoalStatus, Journal } from '../src/core/types.js';
import type { CandidatePort, Clock, Logger } from '../src/ports.js';
import {
  MemoryControl,
  MemoryGoalHost,
  MemoryJournal,
  aCandidate,
  aGoal,
  anEmptyJournal,
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

function construir(candidatos: Candidate[]): {
  supervisor: Supervisor;
  host: MemoryGoalHost;
  journal: MemoryJournal;
} {
  const host = new MemoryGoalHost();
  const journal = new MemoryJournal(anEmptyJournal());
  const supervisor = new Supervisor({
    goalPort: host,
    candidatePort: new StaticCandidates(candidatos),
    journalPort: journal,
    chainLock: { acquire: () => () => {} },
    controlPort: new MemoryControl(),
    clock: fixedClock,
    logger: silentLogger,
    pollIntervalMs: 1,
    parkedPollIntervalMs: 1,
    maxIterations: 1,
  });
  return { supervisor, host, journal };
}

/** Deja el objetivo actual en un estado terminal concreto. */
function liquidar(host: MemoryGoalHost, status: GoalStatus): void {
  host.current = aGoal({ ...(host.current ?? {}), status, updatedAt: NOW });
}

const TERMINALES_FUERA_DE_COMPLETE: GoalStatus[] = ['blocked', 'paused', 'budget_limited'];

describe('un objetivo que termina fuera de complete deja rastro', () => {
  for (const estado of TERMINALES_FUERA_DE_COMPLETE) {
    it(`queda registrado cuando el objetivo termina en ${estado}`, async () => {
      const { supervisor, host, journal } = construir([aCandidate()]);

      await supervisor.run();
      liquidar(host, estado);
      await supervisor.run();

      const registros = journal.state.goals as unknown as Journal['goals'];
      expect(registros).toHaveLength(1);
      expect(registros[0]?.status).toBe(estado);
      expect(registros[0]?.candidateId).toBeTruthy();
    });
  }

  it('el rastro conserva de que objetivo salio, para poder encadenar sin repetir', async () => {
    const { supervisor, host, journal } = construir([aCandidate()]);

    await supervisor.run();
    const goalId = host.current?.goalId;
    liquidar(host, 'blocked');
    await supervisor.run();

    const registros = journal.state.goals as unknown as Journal['goals'];
    expect(registros[0]?.goalId).toBe(goalId);
  });

  it('quedar en un estado terminal que no es complete NO cuenta como trabajo hecho', async () => {
    const { supervisor, host, journal } = construir([aCandidate()]);

    await supervisor.run();
    liquidar(host, 'blocked');
    await supervisor.run();

    // El trabajo bloqueado puede y debe volver a ofrecerse: lo que se registra es el
    // intento, no la victoria. Marcarlo como hecho dejaria trabajo sin hacer
    // apagado para siempre.
    const hechos = journal.state.goals
      .filter((record) => record.status === 'complete')
      .map((record) => record.candidateKey);
    expect(hechos).toHaveLength(0);
  });

  it('el mismo objetivo no se registra dos veces aunque se lea en varios ciclos', async () => {
    const { supervisor, host, journal } = construir([aCandidate()]);

    await supervisor.run();
    liquidar(host, 'blocked');
    await supervisor.run();
    await supervisor.run();

    const registros = journal.state.goals as unknown as Journal['goals'];
    expect(registros).toHaveLength(1);
  });

  it('un objetivo completo sigue registrandose como hasta ahora', async () => {
    const { supervisor, host, journal } = construir([aCandidate()]);

    await supervisor.run();
    host.complete();
    await supervisor.run();

    const registros = journal.state.goals as unknown as Journal['goals'];
    expect(registros).toHaveLength(1);
    expect(registros[0]?.status).toBe('complete');
  });
});