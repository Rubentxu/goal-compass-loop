/**
 * Que se puede afirmar de un objetivo que se perdio.
 *
 * Un objetivo pertenece a la sesion que lo creo. Cuando esa sesion se va, el
 * objetivo se va con ella, y el registro durable se queda con un puntero a
 * algo que ya no esta: nadie sabe si termino, si se quedo a medias o si nunca
 * llego a empezar. Lo unico que sobrevive es el desenlace que el host guardo
 * por su cuenta.
 *
 * Este modulo decide que se puede afirmar a partir de ese desenlace, sin
 * afirmar mas de lo que se sabe. La distincion que importa es entre "no se
 * sabe" y "no termino": son cosas distintas, y solo la segunda permite decir
 * que el trabajo sigue pendiente sin reservas.
 */
import type { GoalStatus, GoalWitness } from './types.js';

/** Lo que se puede afirmar de un objetivo que no esta en su sesion. */
export type LostGoalVerdict =
  /** El host sabe como termino: se registra la verdad. */
  | { kind: 'finished'; status: GoalStatus; reason: string }
  /** El objetivo sigue vivo en la sesion que lo creo: no se duplica. */
  | { kind: 'alive'; reason: string }
  /** No hay manera de saberlo: se registra como interrumpido. */
  | { kind: 'unknown'; reason: string };

/**
 * El veredicto que corresponde a lo que el host dice de un objetivo.
 *
 * `undefined` significa que el host no lo tiene: o ya no lo guarda, o su
 * registro no se ha podido leer. Las dos cosas son lo mismo para quien decide
 * —no hay nada que afirmar— y se dicen con esas palabras.
 */
export function verdictOf(witness: GoalWitness | undefined): LostGoalVerdict {
  if (!witness) {
    return {
      kind: 'unknown',
      reason: 'el host ya no guarda este objetivo: no consta que terminara',
    };
  }

  if (witness.status === 'active') {
    // El host no cierra el estado "activo" de un objetivo que se lleva por
    // delante su sesion: lo deja donde estaba. Por eso el estado no dice si
    // el objetivo sigue trabajando; quien lo dice es su dueno.
    if (witness.ownerAlive) {
      return {
        kind: 'alive',
        reason: 'el objetivo sigue vivo en la sesion que lo creo',
      };
    }
    return {
      kind: 'unknown',
      reason: 'el objetivo se perdio con su sesion y nadie lo cerro: no consta que terminara',
    };
  }

  return {
    kind: 'finished',
    status: witness.status,
    reason: witness.statusReason ?? `el host lo dejo en ${witness.status}`,
  };
}
