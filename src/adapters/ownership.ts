/**
 * Quien puede encadenar trabajo en una mision, y como se evita que dos caminos
 * lo hagan a la vez.
 *
 * Una mision la puede conducir el supervisor, que encadena en bucle, o el
 * plugin, que encadena cuando el agente cierra su turno. Los dos escriben en el
 * mismo journal, consultan el mismo host y ven el objetivo terminado en el
 * mismo instante: sin una regla explicita ambos deciden crear el siguiente y se
 * crean dos. Uno se queda huerfano y sus tokens se pierden.
 *
 * Hay dos piezas, y hacen falta las dos:
 *
 *  - La declaracion. El fichero de mision puede decir quien conduce. Si lo
 *    dice, es la ley: el otro camino se aparta y lo dice, sin tocar nada.
 *  - El candado. Cuando nadie ha declarado nada, el que llegue primero encadena
 *    y el otro espera. El candado dura lo que dura la creacion del objetivo.
 *
 * La declaracion evita la situacion; el candado la hace imposible.
 */
import {
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Driver, Mission } from '../core/types.js';
import { stateRoot } from './journal.js';
import type { ChainLockHandle } from '../ports.js';

/**
 * Cuanto tiempo sigue valiendo el mando si nadie vuelve a moverlo.
 *
 * Un mando caduco no es un problema: el que lo tome decide si la mision sigue
 * viva. Es lo que evita que un proceso muerto deje la mision atada.
 */
export const DRIVER_LEASE_MS = 5 * 60_000;

/** Respuesta a la pregunta de si este camino puede conducir la mision. */
export interface DrivingDecision {
  /** Si este camino puede actuar sobre la mision. */
  drive: boolean;
  /** Por que no puede, cuando no puede. */
  reason?: string;
}

/**
 * Decide si un camino puede conducir la mision.
 *
 * La declaracion manda sobre todo: si el fichero de mision dice quien conduce,
 * ese es el unico que puede actuar. Sin declaracion, manda quien tenga el mando,
 * y si el mando esta caducado, lo puede tomar cualquiera.
 */
export function decideDriving(options: {
  mission: Mission;
  driver: Driver;
  declared: Driver | undefined;
  now: number;
}): DrivingDecision {
  const { mission, driver, declared, now } = options;

  if (declared !== undefined && declared !== driver) {
    return {
      drive: false,
      reason: `la mision declara que la conduce "${declared}"`,
    };
  }

  if (mission.driver !== undefined && mission.driver !== driver) {
    const takenAt = mission.driverAt ?? 0;
    if (now - takenAt <= DRIVER_LEASE_MS) {
      return {
        drive: false,
        reason: `la mision ya la conduce "${mission.driver}"`,
      };
    }
  }

  return { drive: true };
}

/**
 * Quien tomo el candado, y con que sello.
 *
 * El pid basta para saber si el dueno sigue vivo. El sello es lo que permite
 * notar, justo antes de escribir, que el candado ya no es nuestro: sin el, un
 * proceso lento que pierde el candado sigue adelante y su escritura se junta con
 * la de su sustituto.
 */
interface LockOwner {
  pid: number;
  token: string;
}

/** Si un proceso sigue vivo. Un permiso denegado tambien es estar vivo. */
function procesoVivo(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Lo que el fichero del candado dice. Un formato ilegible no inventa un dueno. */
function leerDueno(path: string): LockOwner | null {
  let crudo: string;
  try {
    crudo = readFileSync(path, 'utf8').trim();
  } catch {
    return null;
  }

  try {
    const dato = JSON.parse(crudo) as Partial<LockOwner>;
    if (typeof dato.pid === 'number' && typeof dato.token === 'string') {
      return { pid: dato.pid, token: dato.token };
    }
  } catch {
    // Un candado escrito por una version anterior solo lleva el pid: se
    // reconoce al dueno, pero sin sello no se puede vantar nada sobre el.
  }

  const pid = Number(crudo);
  return Number.isInteger(pid) && pid > 0 ? { pid, token: '' } : null;
}

/**
 * Candado exclusivo para la ventana en la que se encadena un objetivo.
 *
 * Se toma creando el fichero en exclusiva: el sistema operativo garantiza que
 * dos procesos no lo crean a la vez. Se puede tomar tambien cuando su dueno ya
 * no existe —el proceso murio— o cuando lleva demasiado tiempo sin tocarse.
 * Un candado huerfano no puede dejar la mision atada.
 */
export class ChainLock {
  private readonly path: string;

  constructor(missionId: string) {
    this.path = join(stateRoot(), missionId, 'chain.lock');
  }

  /**
   * Intenta tomar el candado. Devuelve la funcion que lo suelta, o `null` si
   * ahora mismo hay otra via encadenando.
   */
  acquire(now: number = Date.now()): ChainLockHandle | null {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
    } catch {
      /* el directorio puede existir: no es un fallo */
    }

    const token = randomUUID();
    try {
      const fd = openSync(this.path, 'wx');
      try {
        writeFileSync(fd, JSON.stringify({ pid: process.pid, token, at: now }), 'utf8');
      } finally {
        closeSync(fd);
      }
      return this.asHandle(token);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }

    // El candado existe. Se puede tomar si su dueno ya no esta —esperar a que
    // caduque no arregla nada cuando nadie va a soltar lo que no existe— o si
    // lleva demasiado tiempo sin tocarse.
    const dueno = leerDueno(this.path);
    if (dueno && !procesoVivo(dueno.pid)) {
      this.quitar();
      return this.acquire(now);
    }

    try {
      const age = now - statSync(this.path).mtimeMs;
      if (age <= DRIVER_LEASE_MS) return null;
    } catch {
      /* el candado desaparecio entre medias: se puede tomar */
    }

    this.quitar();
    return this.acquire(now);
  }

  private asHandle(token: string): ChainLockHandle {
    const handle = ((): void => {
      // Solo se suelta el candado que es nuestro: quitar el de otro proceso
      // seria exactamente el fallo que el candado evita.
      if (this.leerToken() === token) this.quitar();
    }) as ChainLockHandle;

    handle.valid = (): boolean => this.leerToken() === token;
    handle.renew = (renewedAt: number = Date.now()): void => {
      if (this.leerToken() !== token) return;
      try {
        utimesSync(this.path, new Date(renewedAt), new Date(renewedAt));
      } catch {
        /* el candado ya no esta: se nota en la comprobacion siguiente */
      }
    };
    return handle;
  }

  private leerToken(): string | null {
    return leerDueno(this.path)?.token ?? null;
  }

  private quitar(): void {
    try {
      unlinkSync(this.path);
    } catch {
      /* otro proceso lo quito antes: se vuelve a intentar */
    }
  }
}