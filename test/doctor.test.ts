/**
 * El diagnóstico tiene que decir si el plugin está registrado.
 *
 * Declarar una misión no depende del plugin: el fichero se escribe y la
 * misión existe. Que la cadena encadene depende de que el plugin esté
 * registrado en el host, y si no lo está no hay ni un dato que lo diga.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { rmSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tempDir, cleanupTempDirs } from './support/temp.js';
import {
  pluginRegistration,
  pluginRegistrationLine,
  type PluginRegistration,
} from '../src/plugin/registration.js';

afterEach(cleanupTempDirs);

/** Una base de datos del runtime con las instalaciones que se le pidan. */
function runtimeDb(instalaciones: Array<{ name: string; installed?: boolean; enabled?: boolean }>): string {
  const path = join(tempDir('gcl-registro-'), 'runtime-state.sqlite');
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(
    'CREATE TABLE local_runtime_plugin_official_state (' +
      'principal_id TEXT NOT NULL, deployment TEXT NOT NULL, state_json TEXT NOT NULL, ' +
      'updated_at_ms INTEGER NOT NULL, PRIMARY KEY (principal_id, deployment))',
  );
  db.prepare(
    'INSERT INTO local_runtime_plugin_official_state VALUES (?, ?, ?, ?)',
  ).run(
    '1',
    'en-prod',
    JSON.stringify({ schemaVersion: 1, installations: instalaciones }),
    Date.now(),
  );
  db.close();
  return path;
}

describe('el diagnostico sabe si el plugin esta registrado', () => {
  it('lo ve registrado y habilitado cuando esta en el marketplace local', () => {
    // El plugin se instala en el marketplace local del host. Su estado no
    // aparece en el registro de plugins oficiales, asi que un diagnostico que
    // solo mira ahi dice que no esta instalado cuando si lo esta, y manda a
    // reinstalar algo que funciona.
    const marketplace = tempDir('gcl-marketplace-');
    mkdirSync(join(marketplace, 'goal-compass'), { recursive: true });
    const path = runtimeDb([{ name: 'browser-use', installed: true, enabled: true }]);

    const registro = pluginRegistration(path, marketplace);

    expect(registro.installed).toBe(true);
    expect(registro.enabled).toBe(true);
    expect(registro.unknown).toBe(false);
    expect(pluginRegistrationLine(registro)).toContain('registrado y habilitado');
  });

  it('lo ve registrado y habilitado cuando el host lo tiene activo', () => {
    const path = runtimeDb([{ name: 'goal-compass', installed: true, enabled: true }]);

    const registro = pluginRegistration(path, tempDir('gcl-registro-'));

    expect(registro.installed).toBe(true);
    expect(registro.enabled).toBe(true);
    expect(registro.unknown).toBe(false);
    expect(pluginRegistrationLine(registro)).toContain('registrado y habilitado');
  });

  it('lo ve instalado pero deshabilitado, y no lo confunde con que no este', () => {
    const path = runtimeDb([{ name: 'goal-compass', installed: true, enabled: false }]);

    const registro = pluginRegistration(path, tempDir('gcl-registro-'));

    expect(registro.installed).toBe(true);
    expect(registro.enabled).toBe(false);
    expect(pluginRegistrationLine(registro)).toContain('deshabilitado');
  });

  it('lo ve ausente, y dice con que comando se arregla', () => {
    const path = runtimeDb([{ name: 'browser-use', installed: true, enabled: true }]);

    const registro = pluginRegistration(path, tempDir('gcl-registro-'));

    expect(registro.installed).toBe(false);
    expect(registro.enabled).toBe(false);
    expect(pluginRegistrationLine(registro)).toContain('goal-compass install-plugin');
  });

  it('si no se puede leer el estado del host, dice que no se sabe', () => {
    const registro = pluginRegistration(
      join(tempDir('gcl-registro-vacio-'), 'no-existe.sqlite'),
      tempDir('gcl-registro-'),
    );

    expect(registro.unknown).toBe(true);
    expect(pluginRegistrationLine(registro)).toContain('no se ha podido comprobar');
  });

  it('el texto nunca dice que falta algo que no se ha podido comprobar', () => {
    const desconocida: PluginRegistration = { installed: false, enabled: false, unknown: true };

    expect(pluginRegistrationLine(desconocida)).not.toContain('install-plugin');
  });
});
