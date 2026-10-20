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
import { mkdirSync, openSync, closeSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Driver, Mission } from '../core/types.js';
import { stateRoot } from './journal.js';

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
 * La declaracion manda sobre todo: si el fichero de mision dice quien
 * conduce, ese es el unico que puede actuar. Sin declaracion, manda quien
 * tenga el mando, y si el mando esta caducado, lo puede tomar cualquiera.
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
 * Candado exclusivo para la ventana en la que se encadena un objetivo.
 *
 * Se toma creando el fichero en exclusiva: el sistema operativo garantiza que
 * dos procesos no lo crean a la vez. Si el fichero lleva mucho tiempo sin
 * tocarse, su dueño se dio por muerto y se puede tomar: un candado huerfano
 * no puede dejar la mision atada.
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
  acquire(now: number = Date.now()): (() => void) | null {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
    } catch {
      /* el directorio puede existir: no es un fallo */
    }

    try {
      const fd = openSync(this.path, 'wx');
      try {
        writeFileSync(fd, `${process.pid}\n`, 'utf8');
      } finally {
        closeSync(fd);
      }
      return () => this.release();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }

    // El candado existe: solo se puede tomar si lleva demasiado tiempo sin
    // tocarse, que es la senal de que su dueno se quedo sin vida.
    try {
      const age = now - statSync(this.path).mtimeMs;
      if (age <= DRIVER_LEASE_MS) return null;
    } catch {
      /* el candado desaparecio entre medias: se puede tomar */
    }

    try {
      unlinkSync(this.path);
    } catch {
      /* otro proceso lo quito antes: se vuelve a intentar */
    }

    return this.acquire(now);
  }

  private release(): void {
    try {
      unlinkSync(this.path);
    } catch {
      /* ya no estaba: nada que hacer */
    }
  }
}
