/**
 * Directorios temporales que se limpian solos.
 *
 * Un test que deja su temporal en el disco ensucia el sistema y hace que la
 * ejecucion siguiente mida distinto. Aqui se recogen y se borran al terminar
 * cada prueba, haya pasado lo que haya pasado.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Directorios creados y todavia sin borrar. */
const pendientes: string[] = [];

/** Crea un directorio temporal que se limpia al terminar la prueba. */
export function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  pendientes.push(dir);
  return dir;
}

/** Borra los temporales que queden. */
export function cleanupTempDirs(): void {
  for (const dir of pendientes.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
}
