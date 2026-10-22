/**
 * Si el plugin de la misión está registrado en MCode.
 *
 * Declarar una misión es fácil y no depende de nada: el fichero se escribe y
 * la misión existe. Que la cadena *encadene* depende de que el plugin esté
 * registrado en el host. Si no lo está, la misión se declara igualmente y no
 * ocurre nada, sin decir por qué: el fallo es invisible y quien acaba de
 * instalar pasa de «no funciona» a «funciona» sin ningún dato en medio.
 *
 * El registro vive en el estado del host, en la tabla de instalaciones de
 * plugins. Se lee en solo lectura y con fail-closed: si no se puede leer, no
 * se afirma que falte, porque decir que falta algo que no se ha podido
 * comprobar sería inventar.
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { PLUGIN_NAME } from './install.js';

/** La base de datos del runtime, que es donde vive el registro de plugins. */
export function runtimeDbPath(): string {
  return join(homedir(), '.minimax', 'v2', 'sqlite', 'runtime-state.sqlite');
}

/** Lo que se sabe del registro del plugin. */
export interface PluginRegistration {
  /** El host lo tiene instalado. */
  installed: boolean;
  /** El host lo tiene instalado y habilitado. */
  enabled: boolean;
  /** Que no se ha podido comprobar, si no se ha podido comprobar. */
  unknown: boolean;
}

/**
 * Lee el registro de plugins del host.
 *
 * Si la base no está o no se puede leer, no se sabe: se dice que no se sabe,
 * en vez de decir que falta.
 */
export function pluginRegistration(dbPath = runtimeDbPath()): PluginRegistration {
  if (!existsSync(dbPath)) return { installed: false, enabled: false, unknown: true };

  let db: DatabaseSync;
  try {
    db = new DatabaseSync(`file:${dbPath}?mode=ro`, { readOnly: true });
  } catch {
    return { installed: false, enabled: false, unknown: true };
  }

  try {
    const filas = db
      .prepare('SELECT state_json FROM local_runtime_plugin_official_state')
      .all() as Array<{ state_json: string }>;

    let instalado = false;
    let habilitado = false;
    for (const fila of filas) {
      let estado: { installations?: Array<{ name?: string; installed?: boolean; enabled?: boolean }> };
      try {
        estado = JSON.parse(fila.state_json) as typeof estado;
      } catch {
        continue;
      }
      for (const instalacion of estado.installations ?? []) {
        if (instalacion.name !== PLUGIN_NAME) continue;
        instalado = instalado || instalacion.installed === true;
        habilitado = habilitado || (instalacion.installed === true && instalacion.enabled === true);
      }
    }

    return { installed: instalado, enabled: habilitado, unknown: false };
  } catch {
    return { installed: false, enabled: false, unknown: true };
  } finally {
    db.close();
  }
}

/**
 * Como se dice lo del registro, en una frase.
 *
 * Con el comando exacto para arreglarlo, porque un diagnóstico que dice qué
 * pasa pero no cómo arreglarlo solo hace la mitad del trabajo.
 */
export function pluginRegistrationLine(registration: PluginRegistration): string {
  if (registration.unknown) {
    return 'no se ha podido comprobar si el plugin esta registrado (no se ve el estado del host)';
  }
  if (registration.enabled) return 'registrado y habilitado';
  if (registration.installed) {
    return `instalado pero deshabilitado: habilitalo en MCode o vuelve a instalarlo con \`goal-compass install-plugin\``;
  }
  return `no esta registrado: registralo con \`goal-compass install-plugin\``;
}
