/**
 * Si el plugin de la misión está registrado en MCode.
 *
 * Declarar una misión es fácil y no depende de nada: el fichero se escribe y la
 * misión existe. Que la cadena *encadene* depende de que el plugin esté
 * registrado en el host. Si no lo está, la misión se declara igualmente y no
 * ocurre nada, sin decir por qué: el fallo es invisible y quien acaba de
 * instalar pasa de «no funciona» a «funciona» sin ningún dato en medio.
 *
 * El plugin vive en el marketplace local, que es donde lo deja el instalador.
 * El estado del host solo recoge los plugins del marketplace oficial, así que
 * un plugin local que está funcionando parece no existir si solo se mira ahí:
 * el diagnóstico acaba mandando a reinstalar algo que ya funciona.
 *
 * El estado del host se lee en solo lectura y con fail-closed: si no se puede
 * leer, no se afirma que falte, porque decir que falta algo que no se ha podido
 * comprobar sería inventar.
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { defaultMarketplaceDir, PLUGIN_NAME } from './install.js';

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
export function pluginRegistration(
  dbPath = runtimeDbPath(),
  marketplaceDir = defaultMarketplaceDir(),
): PluginRegistration {
  // El marketplace local es la instalacion del producto: si el plugin esta
  // ahi, el host lo puede cargar, diga lo que diga el estado oficial.
  const local = join(marketplaceDir, PLUGIN_NAME);
  const localInstalado = existsSync(local);

  let oficialInstalado = false;
  let oficialHabilitado = false;
  let localDeshabilitado = false;
  let estadoLeido = false;

  if (existsSync(dbPath)) {
    let db: DatabaseSync | undefined;
    try {
      db = new DatabaseSync(`file:${dbPath}?mode=ro`, { readOnly: true });
    } catch {
      db = undefined;
    }
    if (db) {
      try {
        const filas = db
          .prepare('SELECT state_json FROM local_runtime_plugin_official_state')
          .all() as Array<{ state_json: string }>;

        for (const fila of filas) {
          let estado: {
            installations?: Array<{ name?: string; installed?: boolean; enabled?: boolean }>;
          };
          try {
            estado = JSON.parse(fila.state_json) as typeof estado;
          } catch {
            continue;
          }
          for (const instalacion of estado.installations ?? []) {
            if (instalacion.name !== PLUGIN_NAME) continue;
            oficialInstalado = oficialInstalado || instalacion.installed === true;
            oficialHabilitado =
              oficialHabilitado || (instalacion.installed === true && instalacion.enabled === true);
          }
        }
        estadoLeido = true;
      } catch {
        // El estado oficial no se ha podido leer: la parte local sigue valiendo.
      }

      // Los plugins locales que el host tiene apagados se listan por su
      // directorio canonico.
      try {
        const apagados = db
          .prepare('SELECT canonical_root FROM local_runtime_plugin_local_disabled')
          .all() as Array<{ canonical_root: string }>;
        localDeshabilitado = apagados.some((f) => f.canonical_root === resolve(local));
      } catch {
        // La lista no existe o no se ha podido leer: se asume que el plugin
        // local esta en pie, que es lo que el host hace por defecto.
      }
      db.close();
    }
  }

  const installed = localInstalado || oficialInstalado;
  const enabled = oficialHabilitado || (localInstalado && !localDeshabilitado);

  return {
    installed,
    enabled,
    // Sin estado del host y sin instalacion local no se puede saber nada.
    unknown: !estadoLeido && !localInstalado,
  };
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
