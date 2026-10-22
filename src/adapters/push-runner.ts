/**
 * Ejecuta el comando que empuja hacia la sesion, con un tope y sin dejar nietos.
 *
 * El empujon es un turno de agente en otra sesion, y un turno puede tardar
 * minutos. La espera tiene que estar acotada por dos razones:
 *
 *  - sin tope, una espera sin fin deja el proceso colgado. El reloj que mira
 *    las misiones se queda esperando a un comando que no vuelve, y el trabajo
 *    de las demas misiones deja de mirarse justo cuando mas falta hace.
 *  - al cortar al comando hay que cortar a su grupo entero. El comando lanza
 *    el runtime del agente como hijo suyo: matar solo a la cabeza deja al
 *    agente corriendo sin nadie esperandolo, y se acumula turno a turno.
 *
 * Por eso el comando va en su propio grupo de procesos y por eso, al vencer el
 * tope, se manda la senal al grupo y no solo al proceso.
 */
import { spawn, type ChildProcess } from 'node:child_process';

/**
 * Tope por defecto del empujon.
 *
 * El comando de dentro ya lleva su propio tope (`--timeout 10m`), asi que este
 * de aqui es la red de seguridad: va por encima, para que el comando sea quien
 * corta el turno, y por si el comando no vuelve nunca.
 */
export const TOPE_PUSH_MS = 11 * 60_000;

/** Lo que devolvio el empujon. */
export interface PushRun {
  /** Codigo de salida, o nulo si el proceso no llego a terminar. */
  status: number | null;
  stdout: string;
  stderr: string;
  /** Si el comando se paso del tope y lo hubo que cortar. */
  timedOut: boolean;
  /** Si no se pudo lanzar el comando. */
  error?: string;
}

/**
 * Ejecuta el comando que empuja y espera su salida.
 *
 * Nunca espera sin limite: si el comando no termina, se corta su grupo y se
 * vuelve con `timedOut`, que es una manera de decir "esto no ha funcionado"
 * y no "esto se ha quedado colgado".
 */
export async function runPush(
  cmd: string,
  args: string[],
  timeoutMs: number = TOPE_PUSH_MS,
): Promise<PushRun> {
  let stdout = '';
  let stderr = '';
  let timedOut = false;
  let error: string | undefined;

  const child = spawn(cmd, args, {
    // Su propio grupo: al cortar hay que llevarse a los nietos, y para eso
    // hace falta que el grupo exista.
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (trozo: string) => {
    stdout += trozo;
  });
  child.stderr?.on('data', (trozo: string) => {
    stderr += trozo;
  });

  const status = await new Promise<number | null>((resolve) => {
    let resuelto = false;
    const acabar = (codigo: number | null): void => {
      if (resuelto) return;
      resuelto = true;
      resolve(codigo);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      // Se corta y se **espera** a que el grupo este muerto: si se volviera
      // antes de tiempo, el nieto podria seguir vivo un rato y el turno
      // seguiria corriendo sin que nadie lo hubiera pedido.
      void cortar(child, acabar);
    }, timeoutMs);
    timer.unref?.();

    child.on('error', (err: Error) => {
      clearTimeout(timer);
      error = `no se pudo lanzar ${cmd}: ${err.message}`;
      acabar(null);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      acabar(code);
    });
  });

  // Las tuberias se sueltan: si un nieto del comando las tiene abiertas, el
  // proceso se queda esperando un 'data' que no va a llegar.
  child.stdout?.destroy();
  child.stderr?.destroy();
  child.unref();

  return error === undefined ? { status, stdout, stderr, timedOut } : { status, stdout, stderr, timedOut, error };
}

/**
 * Corta el comando y a su grupo entero, y espera a que se格兰.
 *
 * Primero la senal suave, y si el grupo sigue vivo al momento siguiente, la
 * dura. Un runtime que ignora el primer aviso no puede quedarse ahí colgado
 * para siempre, y quien espera no vuelve hasta que el grupo esta muerto.
 */
async function cortar(child: ChildProcess, acabar: (codigo: number | null) => void): Promise<void> {
  const pid = child.pid;
  if (pid === undefined) {
    acabar(null);
    return;
  }

  const muerto = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  enviar(child, pid, 'SIGTERM');

  const suave = await Promise.race([muerto.then(() => true), espera(400).then(() => false)]);
  if (!suave) {
    enviar(child, pid, 'SIGKILL');
    await Promise.race([muerto, espera(1_000)]);
  }
  acabar(null);
}

/** Manda la senal al grupo entero, o al proceso si el grupo no existe. */
function enviar(child: ChildProcess, pid: number, signal: NodeJS.Signals): void {
  try {
    // El grupo entero: el signo negativo es lo que incluye a los nietos.
    process.kill(-pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // El comando ya no esta: no hay nada que cortar.
    }
  }
}

/** Espera un rato. */
function espera(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
