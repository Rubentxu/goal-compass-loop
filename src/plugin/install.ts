/**
 * Ensamblado del plugin de MCode.
 *
 * El plugin se construye a partir de las piezas que ya existen en el
 * proyecto: el grafo de decision que es la skill, y el supervisor compilado.
 * El resultado se deja en el marketplace local de MCode, listo para que
 * `mcode plugin add` lo registre.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Logger } from '../ports.js';

export interface PluginInstallOptions {
  /** Raiz del proyecto: ahi estan `skill/`, `plugin/` y `dist/`. */
  projectRoot: string;
  /** Marketplace local de MCode. */
  marketplaceDir: string;
  logger: Logger;
}

/** Nombre con el que el plugin aparece en MCode. */
export const PLUGIN_NAME = 'goal-compass';

/** Marketplace local por defecto. */
export function defaultMarketplaceDir(): string {
  return join(homedir(), '.minimax', 'plugins');
}

/** Raiz del proyecto, deducida de donde esta este fichero compilado. */
export function projectRootFromModule(moduleUrl: string): string {
  return resolve(fileURLToPath(new URL('../../', moduleUrl)));
}

/**
 * Ensambla el plugin y devuelve el directorio donde queda instalado.
 */
export async function installPlugin(options: PluginInstallOptions): Promise<string> {
  const { projectRoot, marketplaceDir, logger } = options;
  const target = join(marketplaceDir, PLUGIN_NAME);

  const distDir = join(projectRoot, 'dist');
  if (!existsSync(join(distDir, 'plugin', 'auto-continue.js'))) {
    throw new Error(
      'el plugin necesita el supervisor compilado: ejecuta `npm run build` antes de instalarlo',
    );
  }

  if (existsSync(target)) {
    removeRecoverably(target, logger);
  }
  mkdirSync(target, { recursive: true });

  cpSync(join(projectRoot, 'plugin', '.minimax-plugin'), join(target, '.minimax-plugin'), {
    recursive: true,
  });
  cpSync(join(projectRoot, 'plugin', 'hooks'), join(target, 'hooks'), { recursive: true });
  cpSync(join(projectRoot, 'plugin', 'icon.png'), join(target, 'icon.png'));
  cpSync(join(projectRoot, 'skill', PLUGIN_NAME), join(target, 'skills', PLUGIN_NAME), {
    recursive: true,
  });
  cpSync(distDir, join(target, 'dist'), { recursive: true });

  const readme = join(projectRoot, 'plugin', 'README.md');
  if (existsSync(readme)) cpSync(readme, join(target, 'README.md'));

  // Los ficheros del plugin son modulos ES: sin esto, Node los trataria
  // como scriptsCommonJS y la importacion del supervisor fallaria.
  writeFileSync(
    join(target, 'package.json'),
    `${JSON.stringify({ name: PLUGIN_NAME, private: true, type: 'module' }, null, 2)}\n`,
    'utf8',
  );

  logger.info(`plugin ensamblado en ${target}`);
  return target;
}

/**
 * Retira el directorio anterior de forma recuperable.
 *
 * El helper del entorno mueve a la papelera en vez de borrar: si el
 * borrado no se puede hacer de esa forma, se avisa y se sigue, para no
 * dejar al usuario sin plugin por un detalle del sistema de ficheros.
 */
function removeRecoverably(target: string, logger: Logger): void {
  const helper = join(homedir(), '.minimax', 'bin', 'mavis-trash');
  if (!existsSync(helper)) {
    logger.warn(
      `no se encontro el helper de borrado recuperable (${helper}); ` +
        'los ficheros obsoletos del plugin pueden quedar en su sitio',
    );
    return;
  }
  const result = spawnSync(helper, ['--', target], { stdio: 'inherit' });
  if (result.status !== 0) {
    logger.warn(
      `no se pudo retirar la instalacion anterior (${target}); ` +
        'los ficheros obsoletos del plugin pueden quedar en su sitio',
    );
  }
}
