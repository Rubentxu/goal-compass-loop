/**
 * El ejemplo de declaracion es lo que la gente copia.
 *
 * Si el ejemplo esta viejo, la gente copia un fichero que el producto ya no
 * lee entero: campos que se pierden en silencio —el camino que conduce la
 * mision no lo declara nadie— y evidencia que no apunta a nada. Estas pruebas
 * miran el ejemplo como lo que es: una declaracion que el producto tiene que
 * aceptar tal cual, sin tocar una coma.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { anchorExists } from '../src/adapters/declaration-audit.js';
import { loadMissionConfig, MISSION_FILE_NAME } from '../src/adapters/mission.js';

const raiz = resolve(fileURLToPath(new URL('..', import.meta.url)));
const ejemplo = join(raiz, 'examples', 'mission.json');

describe('el ejemplo de declaracion esta al dia', () => {
  it('el producto lo lee entero, con todos los campos que usa hoy', () => {
    const config = loadMissionConfig(ejemplo, { workspace: raiz });

    expect(config.missionId).toBe('ejemplo-mision');
    // El camino que conduce la mision es un campo que el producto lee: si el
    // ejemplo no lo declara, quien lo copia declara una mision sin conductor.
    expect(config.driver).toBe('plugin');
    expect(config.defaultTokenBudget).toBeGreaterThan(0);
    expect(config.totalTokenBudget).toBeGreaterThan(0);
    expect(config.maxGoals).toBeNull();
    expect(config.stallTimeoutMs).toBeGreaterThan(0);
    expect(config.explorationEnabled).toBe(true);
    expect(config.explorationCooldownMs).toBeGreaterThan(0);
    expect(config.allowRemoteWrite).toBe(false);
    expect(config.backlog.length).toBeGreaterThan(0);
  });

  it('su evidencia senala a ficheros y secciones que existen de verdad', () => {
    const config = loadMissionConfig(ejemplo, { workspace: raiz });

    for (const candidate of config.backlog) {
      expect(candidate.evidenceRefs.length, `${candidate.candidateId} sin evidencia`).toBeGreaterThan(0);
      expect(candidate.doneWhen.length, `${candidate.candidateId} sin criterio de cierre`).toBeGreaterThan(0);

      for (const ref of candidate.evidenceRefs) {
        const hash = ref.indexOf('#');
        const file = hash === -1 ? ref : ref.slice(0, hash);
        const anchor = hash === -1 ? '' : ref.slice(hash + 1);
        const path = join(raiz, file);

        expect(existsSync(path), `la evidencia "${ref}" no senala a ningun fichero`).toBe(true);
        if (anchor !== '') {
          expect(
            anchorExists(readFileSync(path, 'utf8'), anchor),
            `la evidencia "${ref}" no senala a ninguna seccion`,
          ).toBe(true);
        }
      }
    }
  });

  it('al copiarlo a un proyecto, se declara sin tocar nada mas', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gcl-ejemplo-'));
    try {
      // Copiarlo es copiarlo tal cual, con una sola cosa cambiada: el
      // workspace, que es donde va a vivir la mision. Lo demas —el camino que
      // conduce, los presupuestos, la evidencia— se queda como esta.
      const raw = JSON.parse(readFileSync(ejemplo, 'utf8')) as Record<string, unknown>;
      raw.workspace = dir;
      const destino = join(dir, MISSION_FILE_NAME);
      writeFileSync(destino, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');

      const config = loadMissionConfig(destino);

      expect(config.workspace).toBe(dir);
      expect(config.driver).toBe('plugin');
      expect(config.backlog.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
