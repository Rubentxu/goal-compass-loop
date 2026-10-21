/**
 * Aparcar no es un estado: es por que la cadena se callo en un instante.
 *
 * El caso que duele: la mision se aparca porque un objetivo lleva rato quieto,
 * y el estado se queda ahi para siempre. Cuando ese objetivo vuelve a trabajar la
 * cadena esta perfectamente sana, pero el journal sigue diciendo que la mision
 * duerme esperando a que alguien la revise, con una razon vieja que ya no explica
 * nada. Quien mira el estado seConvence de que hay un bloqueo donde no lo hay.
 *
 * Aparcar tampoco puede ser una decision irreversible: si el motivo ya no se
 * cumple, la mision se despierta sola. Y las pausas del usuario no se tocan:
 * esas son suyas, no de la cadena.
 */
import { describe, expect, it } from 'vitest';
import { Supervisor } from '../src/supervisor.js';
import type { Candidate, GoalState, Journal, MissionStatus } from '../src/core/types.js';
import type { CandidatePort, Clock, Logger } from '../src/ports.js';
import {
  MemoryControl,
  MemoryGoalHost,
  MemoryJournal,
  aCandidate,
  aGoal,
  aMission,
  anEmptyJournal,
  unCandado,
} from './support/harness.js';

const NOW = 1_700_000_000_000;
const STALL_MS = 60_000;
const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };

/** Backlog que puede cambiar entre ciclos, como el que escribe quien declara. */
class CandidatesQueCambian implements CandidatePort {
  list: Candidate[] = [];
  async discover(): Promise<Candidate[]> {
    return this.list;
  }
}

/** Journal que cuenta sus escrituras, para ver cuando el estado se toca de verdad. */
class JournalQueCuenta extends MemoryJournal {
  guardados = 0;

  override async saveAtomically(state: Journal): Promise<void> {
    this.guardados += 1;
    await super.saveAtomically(state);
  }
}

/** Reloj que la prueba puede adelantar, para que el estancamiento ocurra. */
function unReloj(): Clock & { avanzar(ms: number): void } {
  let t = NOW;
  return {
    now: () => t,
    avanzar: (ms: number) => {
      t += ms;
    },
  };
}

/** Sin trabajo elegible la mision se aparca: esa sigue siendo una via real. */
function construir(candidatos: Candidate[]): {
  supervisor: Supervisor;
  host: MemoryGoalHost;
  journal: JournalQueCuenta;
  control: MemoryControl;
  reloj: Clock & { avanzar(ms: number): void };
  backlog: CandidatesQueCambian;
} {
  const host = new MemoryGoalHost();
  const journal = new JournalQueCuenta(anEmptyJournal(aMission({ stallTimeoutMs: STALL_MS })));
  const control = new MemoryControl();
  const reloj = unReloj();
  const backlog = new CandidatesQueCambian();
  backlog.list = candidatos;
  const supervisor = new Supervisor({
    goalPort: host,
    candidatePort: backlog,
    journalPort: journal,
    chainLock: { acquire: () => unCandado() },
    controlPort: control,
    clock: reloj,
    logger: silentLogger,
    pollIntervalMs: 1,
    parkedPollIntervalMs: 1,
    maxIterations: 1,
  });
  return { supervisor, host, journal, control, reloj, backlog };
}

const estadoDe = (journal: MemoryJournal): MissionStatus => journal.state.mission.status;

/** Objetivo de la cadena, con la forma que devuelve el host. */
function objetivo(chain: MemoryGoalHost, overrides: Partial<GoalState> = {}): void {
  chain.current = aGoal({
    status: 'active',
    tokensUsed: 500,
    turnsUsed: 3,
    statusReason: undefined,
    ...overrides,
  });
}

describe('una mision aparcada se despierta cuando deja de estarlo', () => {
  it('se despierta cuando el objetivo que la aparco vuelve a trabajar', async () => {
    const { supervisor, host, journal, reloj } = construir([]);

    // Un objetivo que no avanza: la mision se aparca.
    objetivo(host, { status: 'paused' });
    await supervisor.run();
    reloj.avanzar(STALL_MS + 1);
    await supervisor.run();
    expect(estadoDe(journal)).toBe('parked');

    // Alguien lo reanuda. La cadena ya tiene trabajo que hacer y solo espera.
    objetivo(host, { status: 'active' });
    await supervisor.run();

    expect(estadoDe(journal)).toBe('running');
  });

  it('deja de mentir sobre por que estaba aparcada', async () => {
    const { supervisor, host, journal, reloj } = construir([]);

    objetivo(host, { status: 'paused' });
    await supervisor.run();
    reloj.avanzar(STALL_MS + 1);
    await supervisor.run();
    expect(journal.state.mission.reason).toBeTruthy();

    objetivo(host, { status: 'active' });
    await supervisor.run();

    expect(journal.state.mission.reason).toBeUndefined();
  });

  it('sigue aparcada mientras el motivo se siga cumpliendo', async () => {
    const { supervisor, host, journal, reloj } = construir([]);

    objetivo(host, { status: 'paused' });
    await supervisor.run();
    reloj.avanzar(STALL_MS + 1);
    await supervisor.run();
    expect(estadoDe(journal)).toBe('parked');

    // Nada cambio: el mismo objetivo, igual de quieto. Despertarse aqui seria
    // mentir en el otro sentido, encendiendo trabajo que sigue sin poder avanzar.
    await supervisor.run();

    expect(estadoDe(journal)).toBe('parked');
  });

  it('se despierta cuando vuelve a haber trabajo que encadenar', async () => {
    // Aparca porque no hay nada que encadenar: el objetivo anterior esta
    // cerrado y la cola vacia. Despues alguien deja trabajo, y una mision
    // aparcada tiene que recogerse en vez de quedarse dormida con la cola ya
    // llena. Es la forma de dormir y la de despertar que se dan de verdad.
    const { supervisor, host, journal, backlog } = construir([]);

    objetivo(host, { status: 'complete' });
    await supervisor.run();
    expect(estadoDe(journal)).toBe('parked');

    backlog.list = [aCandidate()];
    await supervisor.run();

    expect(estadoDe(journal)).toBe('running');
    expect(host.createCount).toBe(1);
  });

  it('una pausa del usuario no se despierta: esa orden es suya', async () => {
    const { supervisor, host, journal, control } = construir([]);

    objetivo(host);
    await supervisor.run();
    control.status = 'paused_by_user';
    await supervisor.run();

    expect(estadoDe(journal)).toBe('paused_by_user');
  });

  it('una mision detenida por el usuario no se despierta', async () => {
    const { supervisor, host, journal, control, reloj } = construir([]);

    objetivo(host);
    await supervisor.run();
    reloj.avanzar(STALL_MS + 1);
    control.status = 'paused_by_user';
    await supervisor.run();

    expect(estadoDe(journal)).toBe('paused_by_user');
  });
});

describe('el rastro de la mision aparcada cuenta como esta', () => {
  it('guarda el motivo por el que se aparco', async () => {
    const { supervisor, host, journal, reloj } = construir([]);

    objetivo(host, { status: 'paused' });
    await supervisor.run();
    reloj.avanzar(STALL_MS + 1);
    await supervisor.run();

    const motivo = journal.state.mission.reason;
    expect(motivo).toBeTruthy();
    expect((journal.state as Journal).mission.status).toBe('parked');
  });

  it('esperando quieto no reescribe el estado en cada ciclo', async () => {
    const { supervisor, host, journal, reloj } = construir([]);

    objetivo(host, { status: 'paused' });
    await supervisor.run();
    reloj.avanzar(STALL_MS + 1);
    await supervisor.run();

    // Sigue aparcada y sigue sin poder avanzar: no hay nada nuevo que contar, asi
    // que el estado no se toca. Escribirlo en cada vuelta seria gastar disco y
    // anunciar un despertar que no ocurre, para volver a dormirse enseguida.
    const guardadosAntes = journal.guardados;
    await supervisor.run();
    await supervisor.run();

    expect(journal.guardados).toBe(guardadosAntes);
    expect(estadoDe(journal)).toBe('parked');
  });
});