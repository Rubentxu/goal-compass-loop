/**
 * El objetivo que se le da al host.
 *
 * El Goal se autoejecuta: su arranque solo lleva el texto del objetivo. Por
 * eso ese texto tiene que llevar dentro la evidencia y el criterio de
 * cierre, o quien trabaja el objetivo no sabe de donde sale el trabajo ni
 * como se demuestra que esta hecho.
 */
import { describe, expect, it } from 'vitest';
import { composeObjective } from '../src/core/types.js';
import { aCandidate } from './support/harness.js';

describe('el objetivo que se le da al host', () => {
  it('lleva el trabajo, la evidencia y el criterio de cierre', () => {
    const objetivo = composeObjective(aCandidate());

    expect(objetivo).toContain('Corregir el fallo de parseo');
    expect(objetivo).toContain('Evidencia: docs/triage.md#parseo');
    expect(objetivo).toContain('Criterio de cierre:');
    expect(objetivo).toContain('La prueba que fallaba pasa');
  });

  it('enumera todos los ficheros de evidencia', () => {
    const objetivo = composeObjective(
      aCandidate({ evidenceRefs: ['docs/roadmap.md#p1', 'spec/requisitos.md'] }),
    );

    expect(objetivo).toContain('Evidencia: docs/roadmap.md#p1, spec/requisitos.md');
  });

  it('enumera todos los criterios de cierre', () => {
    const objetivo = composeObjective(
      aCandidate({ doneWhen: ['La prueba pasa', 'La suite sigue en verde'] }),
    );

    expect(objetivo).toContain('- La prueba pasa');
    expect(objetivo).toContain('- La suite sigue en verde');
  });

  it('no inventa evidencia ni criterio que no existen', () => {
    const objetivo = composeObjective(aCandidate({ evidenceRefs: [], doneWhen: [] }));

    expect(objetivo).toBe('Corregir el fallo de parseo');
    expect(objetivo).not.toContain('Evidencia:');
    expect(objetivo).not.toContain('Criterio de cierre:');
  });

  it('empieza con el texto del trabajo, sin espacios de mas', () => {
    const objetivo = composeObjective(aCandidate());

    expect(objetivo.startsWith('Corregir el fallo de parseo')).toBe(true);
  });
});
