/**
 * Que el empujon al que espera el reloj tenga los pies en la tierra.
 *
 * El empujon es un turno de agente en otra sesion: puede tardar minutos. Antes
 * se esperaba sin limite, con `spawnSync`, asi que un comando que no volvia
 * dejaba el reloj colgado mirando a la nada y las demas misiones dejaban de
 * mirarse justo cuando mas falta hacia.
 *
 * Ademas, al cortar hay que cortar al grupo entero: el comando lanza el runtime
 * del agente como hijo suyo, y matar solo a la cabeza deja al agente corriendo
 * sin nadie esperandolo.
 */
import { describe, expect, it } from 'vitest';
import { runPush } from '../src/adapters/push-runner.js';

/** Un comando que no vuelve nunca. */
const SE_QUEDA_COLGADO = ['-e', 'setTimeout(() => {}, 30000)'];

/** Un comando que se acaba pronto y dice algo. */
const DICE_ALGO = ['-e', 'console.log("hola")'];

/** Espera a que un proceso este muerto de verdad. */
async function esperaQueMuera(pid: number, margenMs = 3_000): Promise<void> {
  const limite = Date.now() + margenMs;
  while (Date.now() < limite) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe('el empujon que espera el reloj', () => {
  it('no espera a un comando que no vuelve', async () => {
    const antes = Date.now();
    const run = await runPush(process.execPath, SE_QUEDA_COLGADO, 300);

    // Sin tope, esto tardaria 30 s. Con tope, sale en un momento.
    expect(Date.now() - antes).toBeLessThan(5_000);
    expect(run.timedOut).toBe(true);
    expect(run.status).toBeNull();
  });

  it('trae lo que dijo el comando cuando el comando se acaba', async () => {
    const run = await runPush(process.execPath, DICE_ALGO, 10_000);

    expect(run.timedOut).toBe(false);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('hola');
  });

  it('no deja al nieto del comando vivo cuando corta', async () => {
    // El comando lanza un hijo que se queda con las tuberias abiertas: es lo
    // que hacia que el proceso que espera se quedase colgado.
    const conNieto = [
      '-e',
      [
        "const { spawn } = require('node:child_process');",
        'const hijo = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: ["pipe","pipe","pipe"] });',
        'console.log(hijo.pid);',
        'setTimeout(() => {}, 30000);',
      ].join('\n'),
    ];

    const run = await runPush(process.execPath, conNieto, 300);
    const pidNieto = Number(run.stdout.trim());

    expect(run.timedOut).toBe(true);
    expect(Number.isFinite(pidNieto)).toBe(true);
    // El nieto no puede seguir vivo: si lo estuviera, seguiria haciendo su
    // trabajo sin que nadie lo hubiera pedido. Se le da un margen porque la
    // senal es una peticion, no un hecho.
    await esperaQueMuera(pidNieto);
    expect(() => process.kill(pidNieto, 0)).toThrow();
  });

  it('dice que no se pudo lanzar el comando en vez de colgarse', async () => {
    const run = await runPush('este-comando-no-existe-jamas', [], 1_000);

    expect(run.error).toBeDefined();
    expect(run.status).toBeNull();
    expect(run.timedOut).toBe(false);
  });
});
