/**
 * Declarar una mision, y lo que pasa cuando dos proyectos comparten estado.
 *
 * La declaracion es la puerta de entrada: sin ella no hay nada que encadenar.
 * Estas comprobaciones cubren lo que un usuario nota: que la declaracion se
 * escriba donde se espera, que se pueda leer de verdad, que no se pise la que
 * ya estaba, y que dos proyectos con el mismo identificador se digan en vez
 * de pisarse en silencio.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { cleanupTempDirs, tempDir } from './support/temp.js';

afterEach(cleanupTempDirs);
import { existsSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';


import { join } from 'node:path';
import {
  declareMission,
  defaultMissionId,
  loadMissionConfig,
  sameWorkspace,
  toMission,
  type MissionConfig,
} from '../src/adapters/mission.js';
import { FileJournal } from '../src/adapters/journal.js';
import { openMission } from '../src/runtime.js';
import type { Journal } from '../src/core/types.js';
import type { Logger } from '../src/ports.js';

const quietLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };


describe('el identificador de una mision', () => {
  it('sale del nombre del proyecto y de su ruta', () => {
    const uno = defaultMissionId('/tmp/proyecto-uno');
    const otro = defaultMissionId('/tmp/proyecto-dos');
    const gemelo = defaultMissionId('/tmp/proyecto-uno');

    expect(uno).toBe(gemelo);
    expect(uno).not.toBe(otro);
  });

  it('dos proyectos con el mismo nombre no comparten identificador', () => {
    const a = defaultMissionId('/tmp/mismo/a');
    const b = defaultMissionId('/tmp/mismo/b');

    expect(a).not.toBe(b);
  });

  it('es corto y se puede escribir en un fichero sin problemas', () => {
    const id = defaultMissionId('/tmp/Un Proyecto Con Espacios y Simbolos &');
    expect(id).toMatch(/^[a-z0-9-]+$/);
    expect(id.length).toBeLessThan(40);
  });
});

describe('declarar una mision', () => {
  it('escribe la declaracion y se puede leer', () => {
    const root = tempDir('gcl-declarar-');
    try {
      const declared = declareMission(root, { objective: 'hacer que el proyecto improves' });

      expect(declared.created).toBe(true);
      expect(existsSync(declared.path)).toBe(true);

      const config = loadMissionConfig(declared.path, { workspace: root });
      expect(config.missionId).toBe(declared.missionId);
      expect(config.objective).toBe('hacer que el proyecto improves');
      expect(config.backlog).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('la conduce el camino que encadena desde la sesion', () => {
    const root = tempDir('gcl-declarar-');
    try {
      const declared = declareMission(root, { objective: 'probar el camino por defecto' });
      expect(declared.driver).toBe('plugin');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('acepta el identificador y el camino que se le pidan', () => {
    const root = tempDir('gcl-declarar-');
    try {
      const declared = declareMission(root, {
        objective: 'probar las opciones',
        missionId: 'mision-propia',
        driver: 'supervisor',
      });

      expect(declared.missionId).toBe('mision-propia');
      const config = loadMissionConfig(declared.path, { workspace: root });
      expect(config.driver).toBe('supervisor');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('declarar dos veces no pisa lo que ya estaba', () => {
    const root = tempDir('gcl-declarar-');
    try {
      const primera = declareMission(root, {
        objective: 'el objetivo original',
        missionId: 'mision-original',
      });
      const antes = readFileSync(primera.path, 'utf8');

      const segunda = declareMission(root, {
        objective: 'otro objetivo',
        missionId: 'mision-distinta',
      });

      expect(segunda.created).toBe(false);
      expect(segunda.missionId).toBe('mision-original');
      expect(readFileSync(primera.path, 'utf8')).toBe(antes);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('el identificador derivado es distinto en cada proyecto', () => {
    const uno = tempDir('gcl-declarar-');
    const otro = tempDir('gcl-declarar-');
    try {
      const a = declareMission(uno, { objective: 'uno' });
      const b = declareMission(otro, { objective: 'otro' });

      expect(a.missionId).not.toBe(b.missionId);
    } finally {
      rmSync(uno, { recursive: true, force: true });
      rmSync(otro, { recursive: true, force: true });
    }
  });
});

describe('el estado que pertenece a otro proyecto', () => {
  it('una mision con el mismo identificador en otro proyecto no conduce', async () => {
    const root = tempDir('gcl-compartido-');
    const otro = tempDir('gcl-compartido-');
    const previous = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = root;
    try {
      const config: MissionConfig = {
        missionId: 'mision-compartida',
        objective: 'probar el reparto',
        workspace: root,
        defaultTokenBudget: 1000,
        totalTokenBudget: null,
        maxGoals: null,
        stallTimeoutMs: 1000,
        explorationEnabled: false,
        explorationCooldownMs: 1000,
        allowRemoteWrite: false,
        backlog: [],
      };

      // El estado durable ya existe y es de otro proyecto.
      const journal = new FileJournal('mision-compartida');
      const existente: Journal = {
        version: 1,
        missionId: 'mision-compartida',
        sessionId: undefined,
        mission: { ...toMission(config), workspace: otro },
        goals: [],
        intents: [],
        progress: undefined,
        explored: [],
        explorationStreak: 0,
        lastExplorationAt: undefined,
        updatedAt: new Date().toISOString(),
      };
      await journal.saveAtomically(existente);

      const runtime = await openMission({
        config,
        configPath: join(root, 'goal-compass.json'),
        logger: quietLogger,
        driver: 'plugin',
      });

      expect(runtime.driving).toBe(false);
      expect(runtime.reason).toContain('mision-compartida');

      // Y el estado del otro proyecto sigue intacto.
      const despues = await journal.load();
      expect(despues?.mission.workspace).toBe(otro);
    } finally {
      if (previous === undefined) delete process.env.XDG_STATE_HOME;
      else process.env.XDG_STATE_HOME = previous;
      rmSync(root, { recursive: true, force: true });
      rmSync(otro, { recursive: true, force: true });
    }
  });

  it('el mismo proyecto con un enlace simbolico sigue siendo el mismo', () => {
    const root = tempDir('gcl-espacio-');
    try {
      const enlace = join(root, 'enlace');
      symlinkSync(root, enlace);

      expect(sameWorkspace(root, enlace)).toBe(true);
      expect(sameWorkspace(root, join(root, 'otro'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('la declaracion se puede escribir a mano', () => {
  it('una declaracion con lo minimo se lee y se usa', () => {
    const root = tempDir('gcl-manual-');
    try {
      const path = join(root, 'goal-compass.json');
      writeFileSync(
        path,
        JSON.stringify({ missionId: 'a-mano', objective: 'trabajo escrito a mano' }),
        'utf8',
      );

      const config = loadMissionConfig(path, { workspace: root });
      expect(config.missionId).toBe('a-mano');
      expect(config.objective).toBe('trabajo escrito a mano');
      expect(config.driver).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('una declaracion a medio hacer se puede leer para decir cual es', () => {
    const root = tempDir('gcl-manual-');
    try {
      const path = join(root, 'goal-compass.json');
      writeFileSync(path, JSON.stringify({ missionId: 'a-medio' }), 'utf8');

      const declared = declareMission(root, { objective: 'no importa' });
      expect(declared.created).toBe(false);
      expect(declared.missionId).toBe('a-medio');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('una declaracion ilegible no borra lo que hay', () => {
    const root = tempDir('gcl-manual-');
    try {
      const path = join(root, 'goal-compass.json');
      writeFileSync(path, 'esto no es json', 'utf8');

      const declared = declareMission(root, { objective: 'no importa' });
      expect(declared.created).toBe(false);
      expect(readFileSync(path, 'utf8')).toBe('esto no es json');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
