/**
 * Un objetivo que no avanza no apaga la mision.
 *
 * Antes, cualquier objetivo estancado o bloqueado devolvia `park` y la cadena
 * se dormia con la cola llena. Estas pruebas fijan la regla contraria: con
 * frontera ejecutable se sigue trabajando por otro lado; sin ella, se espera a
 * una condicion externa conservando la mision.
 */
import { describe, expect, it } from 'vitest';
import { decide } from '../src/core/decide.js';
import { aCandidate, aGoal, aMission, aSnapshot } from './support/harness.js';

const AHORA = 1_700_000_000_000;
const SIN_PROGRESAR = 1_699_999_000_000;

/** Un objetivo bloqueado que lleva rato sin avanzar, con la cola llena. */
function bloqueoConFrontera(estado: 'blocked' | 'paused') {
  return decide(
    aSnapshot({
      goal: aGoal({ status: estado }),
      candidates: [aCandidate({ candidateId: 'otro', priority: 5 })],
      mission: aMission({ stallTimeoutMs: 60_000 }),
      goalProgressSince: SIN_PROGRESAR,
      now: AHORA,
    }),
  );
}

describe('un objetivo bloqueado no aparca la mision si hay trabajo', () => {
  it('con trabajo elegible, encadena el siguiente en vez de aparcar', () => {
    const decision = bloqueoConFrontera('blocked');

    expect(decision.kind).toBe('create');
    if (decision.kind === 'create') {
      expect(decision.candidate.candidateId).toBe('otro');
    }
  });

  it('dice por que cambia de tarea, para que se pueda leer despues', () => {
    const decision = bloqueoConFrontera('blocked');

    expect(decision.reason).toContain('no avanza');
    expect(decision.reason).toContain('otro');
  });

  it('un objetivo pausado tampoco apaga la cadena, porque pausar no siempre es de alguien', () => {
    // Antes se daba por hecho que si: un objetivo pausado era una decision
    // humana y la cadena esperaba. Pero el host tambien pausa —deja el objetivo
    // en pausa mientras valida un cierre— y ahi no hay nadie esperando: la
    // cadena se queda mirando un trabajo que no vuelve solo, con la cola llena.
    //
    // La distincion no es el estado del objetivo, sino quien retiene la
    // mision. Eso ya lo decide la mision, y esas reglas se comprueban antes de
    // llegar aqui: si alguien ha parado la cadena, no se encadena nada.
    const decision = bloqueoConFrontera('paused');

    expect(decision.kind).toBe('create');
    if (decision.kind === 'create') {
      expect(decision.candidate.candidateId).toBe('otro');
    }
  });

  it('pero con la mision en manos de alguien, un objetivo pausado si se respeta', () => {
    const decision = decide(
      aSnapshot({
        mission: aMission({ status: 'paused_by_user' }),
        goal: aGoal({ status: 'paused' }),
        candidates: [aCandidate()],
      }),
    );

    expect(decision.kind).toBe('wait');
  });

  it('un objetivo pausado sin trabajo elegible se aparca, no espera en silencio', () => {
    const decision = decide(
      aSnapshot({
        goal: aGoal({ status: 'paused' }),
        candidates: [],
        mission: aMission({ stallTimeoutMs: 60_000 }),
        goalProgressSince: SIN_PROGRESAR,
        now: AHORA,
      }),
    );

    expect(decision.kind).toBe('park');
    expect(decision.reason).toContain('paused');
  });

  it('el trabajo mas prioritario sigue mandando, no el mas antiguo', () => {
    const decision = decide(
      aSnapshot({
        goal: aGoal({ status: 'blocked' }),
        candidates: [
          aCandidate({ candidateId: 'urgente', priority: 10 }),
          aCandidate({ candidateId: 'tranquilo', priority: 1 }),
        ],
      }),
    );

    expect(decision.kind).toBe('create');
    if (decision.kind === 'create') {
      expect(decision.candidate.candidateId).toBe('urgente');
    }
  });
});

describe('sin trabajo elegible, un objetivo bloqueado sigue esperando', () => {
  it('no se inventa trabajo para no detenerse', () => {
    const decision = decide(
      aSnapshot({
        goal: aGoal({ status: 'blocked' }),
        candidates: [],
        mission: aMission({ stallTimeoutMs: 60_000 }),
        goalProgressSince: SIN_PROGRESAR,
        now: AHORA,
      }),
    );

    expect(decision.kind).toBe('park');
    expect(decision.reason).toContain('blocked');
  });

  it('un trabajo bloqueado y ya hecho tampoco habilita encadenar', () => {
    const decision = decide(
      aSnapshot({
        goal: aGoal({ status: 'blocked' }),
        candidates: [aCandidate({ prerequisites: ['lo-que-falta'] })],
      }),
    );

    expect(decision.kind).not.toBe('create');
  });
});

describe('un objetivo activo manda siempre', () => {
  it('no se encadena otro mientras el suyo avanza', () => {
    const decision = decide(
      aSnapshot({
        goal: aGoal({ status: 'active' }),
        candidates: [aCandidate()],
        mission: aMission({ stallTimeoutMs: 60_000 }),
        goalProgressSince: AHORA - 1_000,
        now: AHORA,
      }),
    );

    expect(decision.kind).toBe('wait');
  });

  it('que avance despacio no apaga la mision', () => {
    // Un objetivo lento puede ser una compilacion larga: es actividad, no un
    // bloqueo. Aparcar aqui apagaba trabajo que si estaba avanzando.
    const decision = decide(
      aSnapshot({
        goal: aGoal({ status: 'active' }),
        candidates: [aCandidate()],
        mission: aMission({ stallTimeoutMs: 60_000 }),
        goalProgressSince: SIN_PROGRESAR,
        now: AHORA,
      }),
    );

    expect(decision.kind).toBe('wait');
    expect(decision.reason).toContain('activo');
  });
});

describe('la autoridad del usuario sigue por encima', () => {
  it('una mision pausada por el usuario no encadena nada aunque haya frontera', () => {
    const decision = decide(
      aSnapshot({
        mission: aMission({ status: 'paused_by_user' }),
        goal: aGoal({ status: 'blocked' }),
        candidates: [aCandidate()],
      }),
    );

    expect(decision.kind).toBe('wait');
  });

  it('una mision detenida por el usuario no encadena nada', () => {
    const decision = decide(
      aSnapshot({
        mission: aMission({ status: 'stopped_by_user' }),
        goal: aGoal({ status: 'blocked' }),
        candidates: [aCandidate()],
      }),
    );

    expect(decision.kind).toBe('wait');
  });

  it('el limite administrativo de Goals manda sobre la frontera', () => {
    const decision = decide(
      aSnapshot({
        mission: aMission({ maxGoals: 2 }),
        goalsCreated: 2,
        goal: aGoal({ status: 'blocked' }),
        candidates: [aCandidate()],
      }),
    );

    expect(decision.kind).toBe('park');
  });
});