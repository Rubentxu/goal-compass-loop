/**
 * Cuando empujar a la sesion para que la cadena no se quede esperando.
 *
 * Lo que se comprueba aqui es una sola cosa: que empujar sirva de algo. Si la
 * cadena la detuvo alguien, empujar es ignorarlo. Si no hay trabajo, empujar es
 * gastar un turno en nada. Si el objetivo acaba de avanzar, empujar es
 * interrumpirlo. Solo queda un caso bueno —la sesion esperando con trabajo
 * delante— y ese es el que se empuja.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_NUDGE_COOLDOWN_MS, DEFAULT_NUDGE_STALL_MS, decideNudge } from '../src/core/nudge.js';
import { normalizeJournal, type MissionStatus } from '../src/core/types.js';
import { aCandidate, aMission, anEmptyJournal } from './support/harness.js';

const AHORA = 1_700_000_000_000;
const HACE_UN_MINUTO = AHORA - 60_000;

function situacion(over: Partial<Parameters<typeof decideNudge>[0]> = {}) {
  return decideNudge({
    missionStatus: 'running' as MissionStatus,
    goalSignature: 'active|3|1200',
    goalProgressSince: HACE_UN_MINUTO,
    hasEligibleWork: true,
    lastNudgeAt: null,
    now: AHORA,
    stallTimeoutMs: DEFAULT_NUDGE_STALL_MS,
    cooldownMs: DEFAULT_NUDGE_COOLDOWN_MS,
    ...over,
  });
}

describe('cuando la sesion necesita que le empurren', () => {
  it('la empuja si lleva rato quieta y hay trabajo esperando', () => {
    const veredicto = situacion({ goalProgressSince: AHORA - 20 * 60_000 });

    expect(veredicto.nudge).toBe(true);
    expect(veredicto.reason).toContain('sin cambiar');
  });

  it('no empuja si el objetivo acaba de avanzar', () => {
    const veredicto = situacion();

    expect(veredicto.nudge).toBe(false);
    expect(veredicto.reason).toContain('avanza');
  });

  it('no empuja si no hay trabajo al que dar entrada', () => {
    const veredicto = situacion({ goalProgressSince: AHORA - 20 * 60_000, hasEligibleWork: false });

    expect(veredicto.nudge).toBe(false);
    expect(veredicto.reason).toContain('trabajo elegible');
  });

  it('no empuja dos veces seguidas por lo mismo', () => {
    const veredicto = situacion({
      goalProgressSince: AHORA - 20 * 60_000,
      lastNudgeAt: AHORA - 60_000,
    });

    expect(veredicto.nudge).toBe(false);
    expect(veredicto.reason).toContain('hace poco');
  });

  it('vuelve a empujar cuando el enfriamiento ha pasado y sigue quieta', () => {
    const veredicto = situacion({
      goalProgressSince: AHORA - 40 * 60_000,
      lastNudgeAt: AHORA - DEFAULT_NUDGE_COOLDOWN_MS - 60_000,
    });

    expect(veredicto.nudge).toBe(true);
  });

  it('no empuja a una cadena que el usuario ha parado', () => {
    for (const estado of ['stopped_by_user', 'paused_by_user'] as MissionStatus[]) {
      const veredicto = situacion({ missionStatus: estado, goalProgressSince: AHORA - 60 * 60_000 });

      expect(veredicto.nudge).toBe(false);
      expect(veredicto.reason).toContain('no se empuja');
    }
  });

  it('no empuja a una cadena escalada: esa necesita a alguien de verdad', () => {
    const veredicto = situacion({ missionStatus: 'escalated', goalProgressSince: AHORA - 60 * 60_000 });

    expect(veredicto.nudge).toBe(false);
    expect(veredicto.reason).toContain('alguien');
  });

  it('sin objetivo en curso no hay nada que empujar', () => {
    // Ni firma que guardar, ni momento en que se guardo: no hay objetivo que
    // pueda estar quieto, por mucho tiempo que carried.
    const sinFirma = situacion({ goalSignature: undefined, goalProgressSince: AHORA - 60 * 60_000 });
    const sinMomento = situacion({ goalProgressSince: null });

    for (const veredicto of [sinFirma, sinMomento]) {
      expect(veredicto.nudge).toBe(false);
      expect(veredicto.reason).toContain('objetivo');
    }
  });

  it('el umbral por defecto son diez minutos sin cambiar nada', () => {
    expect(DEFAULT_NUDGE_STALL_MS).toBe(10 * 60_000);
    expect(DEFAULT_NUDGE_COOLDOWN_MS).toBeGreaterThan(DEFAULT_NUDGE_STALL_MS);
  });
});
describe('un journal de antes se puede mirar igual que uno de ahora', () => {
  it('un backlog viejo sin lista de prerrequisitos se completa al leerlo', () => {
    // Los journals llevan tiempo guardados y sus candidatos son de la epoca en
    // que se escribieron. La lista de prerrequisitos se anadio despues, asi que
    // un backlog viejo no la trae, y quien lo recorra revienta al filtrarla en
    // vez de limitarse a no ver nada.
    const viejo = {
      ...anEmptyJournal(aMission({ backlog: [{ ...aCandidate(), prerequisites: undefined } as never] })),
      explored: [{ ...aCandidate({ candidateId: 'x' }), prerequisites: undefined } as never],
    };

    const leido = normalizeJournal(viejo);

    expect(leido.mission.backlog[0]?.prerequisites).toEqual([]);
    expect(leido.explored[0]?.prerequisites).toEqual([]);
  });

  it('no borra lo que el backlog ya traia', () => {
    const mio = aCandidate({ prerequisites: ['otro'], evidenceRefs: ['a.md'], doneWhen: ['hecho'] });
    const leido = normalizeJournal(anEmptyJournal(aMission({ backlog: [mio] })));

    expect(leido.mission.backlog[0]).toEqual(mio);
  });
});
