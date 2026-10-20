/**
 * Quien conduce la mision, y como se evita que dos caminos encadenen a la vez.
 *
 * Estas comprobaciones son el contrato de la regla: si se rompe, dos vias
 * pueden crear el mismo objetivo y uno se queda huerfano con sus tokens
 * gastados.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChainLock, decideDriving, DRIVER_LEASE_MS } from '../src/adapters/ownership.js';
import { toMission, type MissionConfig } from '../src/adapters/mission.js';
import { openMission } from '../src/runtime.js';
import type { Logger } from '../src/ports.js';
import type { Mission } from '../src/core/types.js';

const quietLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };

function config(): MissionConfig {
  return {
    missionId: 'prueba-mando',
    objective: 'probar el mando',
    workspace: '/tmp/prueba-mando',
    defaultTokenBudget: 1000,
    totalTokenBudget: null,
    maxGoals: null,
    stallTimeoutMs: 1000,
    explorationEnabled: false,
    explorationCooldownMs: 1000,
    allowRemoteWrite: false,
    backlog: [],
  };
}

function mission(driver?: Mission['driver'], driverAt?: number): Mission {
  const base = toMission(config());
  return { ...base, ...(driver ? { driver } : {}), ...(driverAt ? { driverAt } : {}) };
}

describe('el mando de una mision', () => {
  it('sin declaracion, el primero que llega conduce', () => {
    const decision = decideDriving({
      mission: mission(),
      driver: 'supervisor',
      declared: undefined,
      now: 1000,
    });
    expect(decision.drive).toBe(true);
  });

  it('la declaracion manda sobre el mando guardado', () => {
    const decision = decideDriving({
      mission: mission('plugin'),
      driver: 'supervisor',
      declared: 'plugin',
      now: 1000,
    });
    expect(decision.drive).toBe(false);
    expect(decision.reason).toContain('plugin');
  });

  it('quien tiene el mando aparta al otro camino', () => {
    const decision = decideDriving({
      mission: mission('supervisor', 1000),
      driver: 'plugin',
      declared: undefined,
      now: 2000,
    });
    expect(decision.drive).toBe(false);
    expect(decision.reason).toContain('supervisor');
  });

  it('un mando caducado lo puede tomar cualquiera', () => {
    const decision = decideDriving({
      mission: mission('supervisor', 1000),
      driver: 'plugin',
      declared: undefined,
      now: 1000 + DRIVER_LEASE_MS + 1,
    });
    expect(decision.drive).toBe(true);
  });

  it('el propio conductor sigue conduciendo', () => {
    const decision = decideDriving({
      mission: mission('supervisor', 1000),
      driver: 'supervisor',
      declared: undefined,
      now: 2000,
    });
    expect(decision.drive).toBe(true);
  });
});

describe('el camino que no conduce', () => {
  it('no abre el host ni escribe en el estado de la mision', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gcl-apartado-'));
    const previous = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = root;
    try {
      // Un host que solo deja rastro al arrancar: si aparece, alguien abrio.
      const marker = join(root, 'host-arrancado');
      const script = join(root, 'host.mjs');
      writeFileSync(
        script,
        `import { writeFileSync } from 'node:fs';\n` +
          `writeFileSync(${JSON.stringify(marker)}, 'arrancado');\n` +
          `process.exit(0);\n`,
        'utf8',
      );

      const runtime = await openMission({
        config: { ...config(), workspace: root, driver: 'supervisor' },
        configPath: join(root, 'mision.json'),
        logger: quietLogger,
        driver: 'plugin',
        host: { command: process.execPath, args: [script] },
      });

      expect(runtime.driving).toBe(false);
      expect(runtime.reason).toContain('supervisor');
      expect(existsSync(marker)).toBe(false);
      expect(existsSync(join(root, 'goal-compass', 'prueba-mando', 'journal.json'))).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.XDG_STATE_HOME;
      else process.env.XDG_STATE_HOME = previous;
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('el candado de encadenado', () => {
  it('dos vias no pueden encadenar a la vez', () => {
    const root = mkdtempSync(join(tmpdir(), 'gcl-candado-'));
    const previous = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = root;
    try {
      const first = new ChainLock('prueba');
      const second = new ChainLock('prueba');

      const release = first.acquire();
      expect(release).not.toBeNull();
      expect(second.acquire()).toBeNull();

      release!();
      expect(second.acquire()).not.toBeNull();
    } finally {
      if (previous === undefined) delete process.env.XDG_STATE_HOME;
      else process.env.XDG_STATE_HOME = previous;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('un candado huerfano no ata la mision', () => {
    const root = mkdtempSync(join(tmpdir(), 'gcl-candado-'));
    const previous = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = root;
    try {
      const lock = new ChainLock('prueba');
      const path = join(root, 'goal-compass', 'prueba', 'chain.lock');
      mkdirSync(join(root, 'goal-compass', 'prueba'), { recursive: true });
      writeFileSync(path, '999999\n');

      // El candado es viejo: su dueno se dio por muerto y se puede tomar.
      const old = new Date(Date.now() - DRIVER_LEASE_MS - 60_000);
      utimesSync(path, old, old);
      const release = lock.acquire();
      expect(release).not.toBeNull();
      release!();
    } finally {
      if (previous === undefined) delete process.env.XDG_STATE_HOME;
      else process.env.XDG_STATE_HOME = previous;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('el candado se guarda junto al estado de la mision', () => {
    const root = mkdtempSync(join(tmpdir(), 'gcl-candado-'));
    const previous = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = root;
    try {
      const lock = new ChainLock('prueba');
      const release = lock.acquire();
      expect(existsSync(join(root, 'goal-compass', 'prueba', 'chain.lock'))).toBe(true);
      release!();
      expect(existsSync(join(root, 'goal-compass', 'prueba', 'chain.lock'))).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.XDG_STATE_HOME;
      else process.env.XDG_STATE_HOME = previous;
      rmSync(root, { recursive: true, force: true });
    }
  });
});
