/**
 * Como termino un objetivo que ya no esta en ninguna sesion.
 *
 * Un objetivo vive en la sesion que lo creo. Cuando esa sesion se va —el
 * terminal se cierra, el proceso muere, la sesion se reinicia— el objetivo se
 * va con ella, y el registro durable se queda con un puntero a algo que ya no
 * esta: la cadena no sabe si termino, si se quedo a medias o si nunca llego a
 * empezar, y lo unico que conserva es la intencion de encadenarlo.
 *
 * El host guarda en su base de datos el desenlace de cada objetivo que ha
 * creado. Esa es la unica testigo que sobrevive a la sesion, y es la que
 * permite que la cadena recupere el estado en vez de perderlo.
 *
 * El estado "activo" no dice que un objetivo siga trabajando: el host no lo
 * cierra cuando la sesion se lleva el objetivo por delante, asi que el
 * objetivo de una sesion que murio parece vivo para siempre. Por eso se lee
 * tambien la sesion que lo sostenia: si esa sesion sigue en marcha, hay
 * alguien conduciendola y el objetivo no se ha perdido.
 *
 * Lo que no se puede saber, no se dice: si el registro no se puede leer, la
 * respuesta es que no se sabe, no que el objetivo termino de ninguna manera.
 */
import { readRuntimeState, runtimeDbPath } from './runtime-state.js';
import type { GoalStatus, GoalWitness } from '../core/types.js';
import type { GoalHistoryPort } from '../ports.js';

/** Una fila del registro de objetivos, tal y como lo guarda el host. */
interface FilaObjetivo {
  goalId: string;
  status: string;
  tokensUsed: number | null;
  turnsUsed: number | null;
  statusReason: string | null;
  updatedAt: number | null;
  ownerAlive: number;
}

/**
 * El historial de objetivos segun lo guarda el host.
 *
 * La ruta de la base se puede dar para poder mirar otra: asi la comprobacion
 * no depende del estado real de la maquina donde corre.
 */
export class RuntimeGoalHistory implements GoalHistoryPort {
  constructor(private readonly path: string = runtimeDbPath()) {}

  /**
   * Que sabe el host de estos objetivos.
   *
   * Devuelve `undefined` cuando el registro no se ha podido leer: no se sabe
   * nada y no se afirma nada.
   */
  outcomes(goalIds: readonly string[]): Map<string, GoalWitness> | undefined {
    if (goalIds.length === 0) return new Map();

    const marcadores = goalIds.map(() => '?').join(', ');
    const filas = readRuntimeState(
      (db) =>
        db
          .prepare(
            'SELECT g.goal_id AS goalId, g.status AS status, ' +
              'g.tokens_used AS tokensUsed, g.turns_used AS turnsUsed, ' +
              'g.status_reason AS statusReason, g.updated_at_ms AS updatedAt, ' +
              "CASE WHEN s.status = 'started' THEN 1 ELSE 0 END AS ownerAlive " +
              'FROM local_runtime_thread_goals g ' +
              'LEFT JOIN local_runtime_sessions s ON s.session_id = g.session_id ' +
              `WHERE g.goal_id IN (${marcadores})`,
          )
          .all(...goalIds) as unknown as FilaObjetivo[],
      this.path,
    );
    if (!filas) return undefined;

    const encontrados = new Map<string, GoalWitness>();
    for (const fila of filas) {
      encontrados.set(fila.goalId, {
        status: fila.status as GoalStatus,
        tokensUsed: fila.tokensUsed ?? 0,
        turnsUsed: fila.turnsUsed ?? 0,
        statusReason: fila.statusReason,
        updatedAt: fila.updatedAt ?? 0,
        ownerAlive: fila.ownerAlive === 1,
      });
    }
    return encontrados;
  }
}
