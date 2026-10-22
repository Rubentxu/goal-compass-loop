/**
 * Un objetivo que se va con su sesion no se pierde su estado.
 *
 * El caso que duele: un objetivo se completa, su sesion se cierra y el
 * registro durable nunca llega a guardar su desenlace. El trabajo se queda
 * como pendiente, la cadena lo vuelve a ofrecer y aparece un objetivo nuevo
 * para lo mismo. Repetir asi es lo que hace que una mission consuma su
 * presupuesto sin avanzar.
 *
 * El unico que sabe como termino es el host, que guarda el desenlace de cada
 * objetivo por su cuenta. Lo que no se sabe no se dice: un objetivo que se
 * perdio sin dejar rastro se registra como lo que es —interrumpido— y no como
 * un trabajo hecho ni como un trabajo que fallo por una causa concreta.
 */
import { describe, expect, it } from 'vitest';
import { Supervisor } from '../src/supervisor.js';
import { verdictOf } from '../src/core/lost-goal.js';
import type { Candidate, GoalWitness } from '../src/core/types.js';
import type { CandidatePort, Clock, Logger } from '../src/ports.js';
import {
  MemoryControl,
  MemoryGoalHistory,
  MemoryGoalHost,
  aCandidate,
  anEmptyJournal,
  unCandado,
  unJournalConObjetivoPerdido,
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

function construir(
  journal: ReturnType<typeof unJournalConObjetivoPerdido>,
  candidates: Candidate[],
  history: MemoryGoalHistory,
): { supervisor: Supervisor; host: MemoryGoalHost } {
  const host = new MemoryGoalHost();
  const supervisor = new Supervisor({
    goalPort: host,
    candidatePort: new StaticCandidates(candidates),
    journalPort: journal,
    historyPort: history,
    chainLock: { acquire: () => unCandado() },
    controlPort: new MemoryControl(),
    clock: fixedClock,
    logger: quietLogger,
    pollIntervalMs: 1,
    parkedPollIntervalMs: 1,
    maxIterations: 1,
  });
  return { supervisor, host };
}

describe('lo que se puede afirmar de un objetivo que no esta en su sesion', () => {
  const activo = (ownerAlive: boolean): GoalWitness => ({
    status: 'active',
    tokensUsed: 500,
    turnsUsed: 1,
    statusReason: null,
    updatedAt: NOW,
    ownerAlive,
  });

  const casos: { nombre: string; witness: GoalWitness | undefined; kind: string }[] = [
    { nombre: 'el host ya no lo guarda', witness: undefined, kind: 'unknown' },
    { nombre: 'el host sabe como termino', witness: { ...activo(false), status: 'complete' }, kind: 'finished' },
    { nombre: 'el objetivo sigue vivo', witness: activo(true), kind: 'alive' },
    { nombre: 'el objetivo se perdio con su sesion', witness: activo(false), kind: 'unknown' },
  ];

  for (const caso of casos) {
    it(caso.nombre, () => {
      expect(verdictOf(caso.witness).kind).toBe(caso.kind);
    });
  }
});

describe('un objetivo perdido recupera su estado', () => {
  it('recupera el desenlace de un objetivo que se completo sin llegar a registrarse', async () => {
    const candidate = aCandidate();
    const journal = unJournalConObjetivoPerdido(candidate, { goalId: 'tg_hecho' });
    const history = new MemoryGoalHistory();
    history.ended('tg_hecho', { tokensUsed: 656_970, statusReason: 'complete(verifier_met)' });
    const { supervisor, host } = construir(journal, [candidate], history);

    const outcome = await supervisor.step();

    const registro = journal.state.goals.find((goal) => goal.goalId === 'tg_hecho');
    expect(registro?.status).toBe('complete');
    expect(registro?.tokensUsed).toBe(656_970);

    // El trabajo esta pagado: no se vuelve a ofrecer, que es de donde venia
    // la repeticion.
    expect(host.createCount).toBe(0);
    expect(outcome.decision.kind).toBe('park');
  });

  it('registra como interrumpido el objetivo que se perdio sin dejar rastro', async () => {
    const candidate = aCandidate();
    const journal = unJournalConObjetivoPerdido(candidate, { goalId: 'tg_perdido' });
    const history = new MemoryGoalHistory();
    const { supervisor, host } = construir(journal, [candidate], history);

    await supervisor.step();

    const registro = journal.state.goals.find((goal) => goal.goalId === 'tg_perdido');
    expect(registro?.status).toBe('interrupted');
    expect(registro?.statusReason).toContain('no consta que terminara');

    // No se afirma que el trabajo se hizo: el trabajo sigue disponible y el
    // intento cuenta, que es lo que acota las repeticiones.
    const hechos = journal.state.goals.filter((goal) => goal.status === 'complete');
    expect(hechos).toHaveLength(0);
    expect(host.createCount).toBe(1);
    expect(journal.state.intents).toHaveLength(2);
  });

  it('no vuelve a encadenar el trabajo cuyo objetivo sigue vivo', async () => {
    const candidate = aCandidate();
    const journal = unJournalConObjetivoPerdido(candidate, { goalId: 'tg_vivo' });
    const history = new MemoryGoalHistory();
    history.alive('tg_vivo');
    const { supervisor, host } = construir(journal, [candidate], history);

    const outcome = await supervisor.step();

    // El objetivo no ha terminado, asi que no se registra como perdido.
    expect(journal.state.goals.find((goal) => goal.goalId === 'tg_vivo')).toBeUndefined();

    // Y su trabajo no se encadena otra vez: el objetivo vivo haria el trabajo
    // a la vez que el nuevo.
    expect(host.createCount).toBe(0);
    expect(outcome.decision.kind).toBe('park');
    expect(outcome.decision.reason).toContain('en curso');
  });

  it('aparta el trabajo que se pierde repetidamente en vez de repetirlo', async () => {
    const candidate = aCandidate();
    const journal = unJournalConObjetivoPerdido(candidate, { goalId: 'tg_1' });
    // Los dos intentos anteriores del mismo trabajo.
    for (const goalId of ['tg_2', 'tg_3']) {
      journal.state.intents.push({ ...journal.state.intents[0]!, intentId: goalId, goalId });
    }
    const history = new MemoryGoalHistory();
    const { supervisor, host } = construir(journal, [candidate], history);

    const outcome = await supervisor.step();

    // Tres intentos sin completarse: el cuarto lo ve un humano.
    expect(host.createCount).toBe(0);
    expect(outcome.decision.kind).toBe('park');
    expect(outcome.decision.reason).toContain('demasiados intentos');
  });

  it('no afirma nada cuando el registro del host no se puede leer', async () => {
    const candidate = aCandidate();
    const journal = unJournalConObjetivoPerdido(candidate, { goalId: 'tg_hecho' });
    const history = new MemoryGoalHistory();
    history.unreadable = true;
    const { supervisor } = construir(journal, [candidate], history);

    await supervisor.step();

    // Un registro mudo no puede afirmar nada: no se registra ningun desenlace
    // y se vuelve a preguntar en el siguiente ciclo.
    expect(journal.state.goals).toHaveLength(0);
  });
});
