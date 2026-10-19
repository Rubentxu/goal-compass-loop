/**
 * Localización de la misión de un workspace.
 *
 * La misión se declara en un fichero que vive junto al trabajo que se quiere
 * encadenar. Buscarlo es cosa de este módulo para que el hook y el servidor
 * de herramientas miren exactamente el mismo sitio.
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { loadMissionConfig, type MissionConfig } from '../adapters/mission.js';

/** Nombres admitidos para la declaración de la misión, por orden. */
const MISSION_FILES = ['goal-compass.json', join('.goal-compass', 'mission.json')];

/** Busca el fichero de declaración de la misión en un directorio. */
export function findMissionFile(cwd: string): string | null {
  for (const name of MISSION_FILES) {
    const candidate = join(cwd, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Busca la declaración de la misión en el directorio y en sus ancestros.
 *
 * Mirar hacia arriba evita tener que repetir la ruta en cada subcarpeta: el
 * agente puede estar trabajando en `src/adapters/` y la misión seguir
 * declarándose en la raíz del repositorio.
 */
export function findMissionFileUpwards(cwd: string): string | null {
  let current = resolve(cwd);
  for (;;) {
    const found = findMissionFile(current);
    if (found) return found;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export interface LocatedMission {
  config: MissionConfig;
  configPath: string;
  workspace: string;
}

/**
 * Localiza y lee la misión de un workspace.
 *
 * El `workspace` de la declaración manda; si no está, se toma el directorio
 * donde vive el fichero, que es lo que espera quien escribe la misión dentro
 * del repositorio que va a mejorar.
 */
export function locateMission(cwd: string): LocatedMission | null {
  const configPath = findMissionFileUpwards(cwd);
  if (!configPath) return null;
  const workspace = dirname(configPath);
  const config = loadMissionConfig(configPath, { workspace });
  return { config, configPath, workspace: config.workspace };
}
