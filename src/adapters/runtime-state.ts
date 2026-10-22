/**
 * El estado del runtime del host, en solo lectura.
 *
 * El host guarda en su base de datos lo que el host sabe: las sesiones, los
 * plugins que tiene instalados, los objetivos que se han creado. Esa base es
 * la unica testigo que sobrevive a la sesion que lo sostenia: cuando la
 * sesion se va, su objetivo se va con ella, y el registro del host es lo unico
 * que queda para saber como termino.
 *
 * Se lee en solo lectura y con fail-closed: si la base no esta o no se puede
 * leer, no se sabe. Un testigo mudo no puede afirmar nada, y afirmar sin pruebas
 * es peor que callar.
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** La base de datos del runtime, que es donde vive el estado del host. */
export function runtimeDbPath(): string {
  return join(homedir(), '.minimax', 'v2', 'sqlite', 'runtime-state.sqlite');
}

/**
 * Lee de la base del runtime con una consulta.
 *
 * Devuelve `undefined` cuando no se puede leer: la base puede no estar, puede
 * no abrirse en solo lectura o puede no tener la tabla que se le pregunta.
 */
export function readRuntimeState<T>(
  query: (db: DatabaseSync) => T,
  path: string = runtimeDbPath(),
): T | undefined {
  if (!existsSync(path)) return undefined;

  let db: DatabaseSync;
  try {
    db = new DatabaseSync(`file:${path}?mode=ro`, { readOnly: true });
  } catch {
    return undefined;
  }

  try {
    return query(db);
  } catch {
    return undefined;
  } finally {
    db.close();
  }
}
