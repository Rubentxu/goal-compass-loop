/**
 * Dos relojes se estorban.
 *
 * El reloj decide cuando empujar a una sesion, asi que si hay dos, cada uno ve
 * la cadena quieta y los dos empujan: la sesion gasta dos turnos en lo mismo y
 * el segundo llega debajo del primero. Lo que se comprueba aqui es que un reloj
 * se excuse a dejar sitio, y que un candado de un reloj muerto no bloquee a
 * nadie —porque bloquearia justo cuando mas falta haria falta.
 */
import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { takeWatchLock, watchLockPath } from '../src/plugin/watch-lock.js';

function raiz(): string {
  return mkdtempSync(join(tmpdir(), 'gcl-candado-'));
}

describe('un solo reloj a la vez', () => {
  it('el primero entra y el segundo se excuse con nombre', () => {
    const root = raiz();
    expect(takeWatchLock(root).tomado).toBe(true);

    // Otro reloj de verdad, no una cuenta: hay que comprobar que existe.
    const otro = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], { stdio: 'ignore' });
    try {
      writeFileSync(watchLockPath(root), `${otro.pid}\n`, 'utf8');
      const segundo = takeWatchLock(root);

      expect(segundo.tomado).toBe(false);
      if (!segundo.tomado) expect(segundo.dueno).toBe(otro.pid);
    } finally {
      otro.kill('SIGKILL');
    }
  });

  it('un candado de un reloj que murio no bloquea', () => {
    const root = raiz();
    // Un identificador que casi seguro no existe.
    writeFileSync(watchLockPath(root), '999999\n', 'utf8');

    expect(takeWatchLock(root).tomado).toBe(true);
  });

  it('un candado vacio o corrupto no bloquea', () => {
    for (const roto of ['', '   ', 'no soy un numero']) {
      const root = raiz();
      writeFileSync(watchLockPath(root), roto, 'utf8');

      expect(takeWatchLock(root).tomado).toBe(true);
    }
  });

  it('el dueno puede volver a entrar sin depender del candado', () => {
    const root = raiz();
    expect(takeWatchLock(root).tomado).toBe(true);
    // El mismo proceso que ya lo tiene vuelve a pedirlo: entra, no se，讨论.
    expect(takeWatchLock(root).tomado).toBe(true);
  });
});