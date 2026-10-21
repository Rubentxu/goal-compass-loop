/**
 * Un solo reloj.
 *
 * El reloj decide cuando empujar a una sesion, asi que dos relojes no se
 * reparten el trabajo: se estorban. Cada uno ve la cadena quieta, los dos
 * empujan, y la sesion recibe dos prompts por el mismo motivo — dos turnos
 * gastados en lo mismo, y el segundo debajo del primero.
 *
 * El candado guarda el identificador del proceso que lo tiene. Si el fichero
 * no esta vacio, se mira si ese proceso sigue vivo: si ya no, el candado era
 * de un reloj que murio y se puede quitar; si sigue, hay otro reloj y no se
 * entra. Un candado de un proceso que no existe no bloquea a nadie, porque
 * bloquearia justo cuando mas falta haria falta.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { stateRoot } from '../adapters/journal.js';

/** Donde vive el candado del reloj. */
export function watchLockPath(root = stateRoot()): string {
  return join(root, 'watch.lock');
}

/**
 * Toma el candado para este proceso.
 *
 * Devuelve el identificador del dueno cuando no se puede entrar, para poder
 * decir quien esta delante en lugar de fallar sin más.
 */
export function takeWatchLock(root = stateRoot()): { tomado: true } | { tomado: false; dueno: number } {
  const path = watchLockPath(root);
  try {
    mkdirSync(dirname(path), { recursive: true });
  } catch {
    // Sin directorio no hay candado: se informa abajo al no poder escribir.
  }

  const anterior = leerDueno(path);
  if (anterior !== null && anterior !== process.pid && sigueVivo(anterior)) {
    return { tomado: false, dueno: anterior };
  }

  try {
    writeFileSync(path, `${process.pid}\n`, 'utf8');
  } catch {
    // Si ni siquiera esto se puede escribir, mejor entrar sin candado que no
    // entrar nunca: el daño de dos relojes es menor que el de ninguno.
    return { tomado: true };
  }
  return { tomado: true };
}

/** Suelta el candado, pero solo si es de este proceso. */
export function releaseWatchLock(root = stateRoot()): void {
  const path = watchLockPath(root);
  if (leerDueno(path) !== process.pid) return;
  try {
    writeFileSync(path, '', 'utf8');
  } catch {
    // Nada que hacer: un candado que no se puede quitar se limpia al morir.
  }
}

/** El identificador que dejo el dueno actual, si hay. */
function leerDueno(path: string): number | null {
  try {
    const escrito = Number(readFileSync(path, 'utf8').trim());
    return Number.isFinite(escrito) && escrito > 0 ? escrito : null;
  } catch {
    return null;
  }
}

/** Si ese proceso sigue por aqui. */
function sigueVivo(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // Sin permiso no es que este muerto: es que no se puede preguntar.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}