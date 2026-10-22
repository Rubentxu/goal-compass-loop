/**
 * El candado con valla: saber si sigue siendo nuestro, y soltar al muerto.
 *
 * Un candado mudo responde a una sola pregunta: ¿esta ocupado? Con eso basta
 * mientras quien lo tiene termina rapido. En cuanto la operacion tarda —una
 * creacion de objetivo sobre un host ocupado puede tardar— el dueno puede
 * perder el candado sin enterarse y seguir escribiendo al lado de su sustituto.
 * Estas pruebas fijan las dos preguntas que faltaban.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ChainLock } from '../src/adapters/ownership.js';
import { Supervisor } from '../src/supervisor.js';
import type { ChainLockHandle, CandidatePort, Clock, Logger } from '../src/ports.js';
import type { Candidate } from '../src/core/types.js';
import {
  MemoryControl,
  MemoryGoalHost,
  MemoryJournal,
  aCandidate,
  anEmptyJournal,
  MemoryGoalHistory,
} from './support/harness.js';
import { cleanupTempDirs, tempDir } from './support/temp.js';

afterEach(cleanupTempDirs);

/** Aísla el estado de la misión en un directorio propio. */
function aislando<T>(body: (lockPath: (mission: string) => string) => T): T {
  const root = tempDir('gcl-valla-');
  const previous = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = root;
  try {
    return body((mission) => join(root, 'goal-compass', mission, 'chain.lock'));
  } finally {
    if (previous === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = previous;
    rmSync(root, { recursive: true, force: true });
  }
}

describe('la valla del candado', () => {
  it('el candado tomado sigue siendo nuestro mientras nadie lo toque', () => {
    aislando(() => {
      const candado = new ChainLock('valla').acquire();

      expect(candado).not.toBeNull();
      expect(candado!.valid()).toBe(true);
    });
  });

  it('alguien que no lo tiene no puede hacer nada con el', () => {
    aislando(() => {
      const dueno = new ChainLock('valla').acquire();
      const intruso = new ChainLock('valla');

      // El intruso no lo consigue mientras el dueno lo tiene...
      expect(intruso.acquire()).toBeNull();
      // ...y por mucho que mire, el candado no es suyo.
      expect((intruso.acquire() as { valid?: () => boolean } | null)?.valid?.() ?? false).toBe(false);
      expect(dueno!.valid()).toBe(true);
    });
  });

  it('el candado guardado dice quien lo tiene y con que sello', () => {
    aislando((lockPath) => {
      const candado = new ChainLock('valla').acquire();
      const dueno = JSON.parse(readFileSync(lockPath('valla'), 'utf8')) as { pid: number; token: string };

      expect(dueno.pid).toBe(process.pid);
      expect(dueno.token).not.toBe('');
      candado!();
    });
  });

  it('un dueno que ya no existe suelta el candado al instante', () => {
    aislando((lockPath) => {
      const path = lockPath('muerto');
      mkdirSync(join(path, '..'), { recursive: true });
      // Un proceso que no existe: no hay nadie que llegue a soltarlo nunca.
      writeFileSync(path, JSON.stringify({ pid: 2_147_480_000, token: 'x', at: Date.now() }));

      const candado = new ChainLock('muerto').acquire();

      expect(candado).not.toBeNull();
      expect(candado!.valid()).toBe(true);
      candado!();
    });
  });

  it('un dueno vivo y con el candado fresco no se puede tomar', () => {
    aislando((lockPath) => {
      const path = lockPath('vivo');
      mkdirSync(join(path, '..'), { recursive: true });
      writeFileSync(path, JSON.stringify({ pid: process.pid, token: 'otro', at: Date.now() }));

      expect(new ChainLock('vivo').acquire()).toBeNull();
    });
  });

  it('un candado escrito antes de tener sello sigue reconociendo a su dueno', () => {
    aislando((lockPath) => {
      const path = lockPath('antiguo');
      mkdirSync(join(path, '..'), { recursive: true });
      // Formato de las versiones previas: solo el pid.
      writeFileSync(path, `${process.pid}\n`);

      expect(new ChainLock('antiguo').acquire()).toBeNull();
    });
  });

  it('un dueno que ya no existe suelta el candado aunque el formato sea antiguo', () => {
    aislando((lockPath) => {
      const path = lockPath('antiguo-muerto');
      mkdirSync(join(path, '..'), { recursive: true });
      writeFileSync(path, '2147480000\n');

      const candado = new ChainLock('antiguo-muerto').acquire();

      expect(candado).not.toBeNull();
      candado!();
    });
  });
});

describe('renovar y soltar', () => {
  it('renovar mantiene el candado fresco y sigue siendo nuestro', () => {
    aislando((lockPath) => {
      const candado = new ChainLock('renovar').acquire();
      const antes = readFileSync(lockPath('renovar'), 'utf8');

      candado!.renew();

      expect(candado!.valid()).toBe(true);
      // El contenido no cambia al renovar: lo que cambia es cuando se toco.
      expect(readFileSync(lockPath('renovar'), 'utf8')).toBe(antes);
      candado!();
    });
  });

  it('soltar quita el fichero y deja que otro lo tome', () => {
    aislando((lockPath) => {
      const primero = new ChainLock('soltar').acquire();
      primero!();

      expect(existsSync(lockPath('soltar'))).toBe(false);
      expect(new ChainLock('soltar').acquire()).not.toBeNull();
    });
  });

  it('soltar un candado que ya es de otro no borra el suyo', () => {
    aislando((lockPath) => {
      const viejo = new ChainLock('pisado').acquire();
      // Otro proceso se lleva el candado mientras el primero sigue ocupado.
      rmSync(lockPath('pisado'), { force: true });
      const nuevo = new ChainLock('pisado').acquire();
      expect(nuevo).not.toBeNull();

      // El dueño viejo suelta: no tiene derecho a borrar el candado ajeno.
      viejo!();

      expect(existsSync(lockPath('pisado'))).toBe(true);
      expect(nuevo!.valid()).toBe(true);
      nuevo!();
    });
  });

  it('un dueno que perdio el candado lo nota antes de escribir', () => {
    aislando((lockPath) => {
      const lento = new ChainLock('lento').acquire();
      rmSync(lockPath('lento'), { force: true });
      const rapido = new ChainLock('lento').acquire();
      expect(rapido).not.toBeNull();

      // El lento pregunta antes de escribir y descubre que ya no es suyo.
      expect(lento!.valid()).toBe(false);
      rapido!();
    });
  });
});
describe('el supervisor consulta la valla antes de escribir', () => {
  const NOW = 1_700_000_000_000;
  const silencioso: Logger = { info: () => {}, warn: () => {}, error: () => {} };
  const reloj: Clock = { now: () => NOW };

  class Candidatos implements CandidatePort {
    constructor(private readonly lista: Candidate[]) {}
    async discover(): Promise<Candidate[]> {
      return this.lista;
    }
  }

  /** Un candado que responde verdad un numero de veces y luego mentira. */
  function candadoQueCaducaTras(consultas: number): ChainLockHandle {
    let hechas = 0;
    const candado = (() => {}) as ChainLockHandle;
    candado.valid = () => {
      hechas += 1;
      return hechas <= consultas;
    };
    candado.renew = () => {};
    return candado;
  }

  function montar(candado: ChainLockHandle): {
    supervisor: Supervisor;
    host: MemoryGoalHost;
    journal: MemoryJournal;
  } {
    const host = new MemoryGoalHost();
    const journal = new MemoryJournal(anEmptyJournal());
    const supervisor = new Supervisor({
      goalPort: host,
      candidatePort: new Candidatos([aCandidate()]),
      journalPort: journal,
      historyPort: new MemoryGoalHistory(),
      chainLock: { acquire: () => candado },
      controlPort: new MemoryControl(),
      clock: reloj,
      logger: silencioso,
      pollIntervalMs: 1,
      parkedPollIntervalMs: 1,
      maxIterations: 1,
    });
    return { supervisor, host, journal };
  }

  it('confirma el objetivo mientras el candado siga siendo suyo', async () => {
    const { supervisor, host, journal } = montar(candadoQueCaducaTras(99));

    await supervisor.run();

    expect(host.createCount).toBe(1);
    expect(journal.state.intents[0]?.status).toBe('committed');
  });

  it('si lo pierde al volver del host, no toca el estado', async () => {
    const { supervisor, host, journal } = montar(candadoQueCaducaTras(1));

    await supervisor.run();

    // El objetivo si llego a crearse —eso ya no se puede deshacer—, pero la
    // intencion queda sin confirmar: otro la reconciliara en vez de duplicarlo.
    expect(host.createCount).toBe(1);
    expect(journal.state.intents[0]?.status).toBe('intent');
    expect(journal.state.intents[0]?.goalId).toBeUndefined();
  });

  it('si ya no lo tiene ni al empezar, no escribe nada', async () => {
    const { supervisor, host, journal } = montar(candadoQueCaducaTras(0));

    await supervisor.run();

    expect(host.createCount).toBe(0);
    expect(journal.state.intents).toHaveLength(0);
  });
});
