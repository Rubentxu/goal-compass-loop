/**
 * El directorio de trabajo de la mision dentro del proyecto.
 *
 * El arbol de decision que sigue un proyecto puede ser el que trae la skill o
 * uno propio. El propio vive en un subdirectorio de trabajo, `.goal-compass/`,
 * que **esta ignorado por git**: es configuracion local del proyecto y no
 * debe ensuciar el `git status` de quien esta trabajando.
 *
 * Ignorarlo es una cortesía, no un capricho: una herramienta que deja ficheros
 * sin versionar en el repositorio de otra persona se gana el mistrust de quien
 * la usa. Por eso el directorio se crea junto con su entrada en `.gitignore`,
 * y se puede compartir si el proyecto quiere: git permite añadir a mano lo que
 * está ignorado.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Nombre del subdirectorio de trabajo. */
export const WORKDIR_NAME = '.goal-compass';

/** Como quedo el directorio de trabajo tras asegurarlo. */
export interface WorkdirState {
  /** Donde esta el directorio. */
  path: string;
  /** Si ha habido que crearlo. */
  created: boolean;
  /** Si ha habido que anadir la entrada al `.gitignore`. */
  gitignoreAdded: boolean;
  /** Si el directorio queda ignorado por git. */
  ignored: boolean;
}

/** Donde vive el directorio de trabajo de un workspace. */
export function workdirPath(workspace: string): string {
  return join(workspace, WORKDIR_NAME);
}

/**
 * Prepara el directorio de trabajo: lo crea si falta y asegura que git lo
 * ignore.
 *
 * No hace nada destructivo: si el directorio ya existe, lo deja como esta.
 */
export function ensureWorkdir(workspace: string): WorkdirState {
  const path = workdirPath(workspace);
  const created = !existsSync(path);
  if (created) mkdirSync(path, { recursive: true });

  const gitignoreAdded = ensureIgnored(workspace);
  return { path, created, gitignoreAdded, ignored: isIgnored(workspace) };
}

/**
 * Si el workspace tiene ya su entrada en `.gitignore`.
 *
 * Se buscan las formas usuales de escribirla: con barra inicial, con barra
 * final o sin ninguna.
 */
export function isIgnored(workspace: string): boolean {
  const path = join(workspace, '.gitignore');
  if (!existsSync(path)) return false;

  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .some((line) => {
      const normalized = line.replace(/^\//, '').replace(/\/$/, '');
      return normalized === WORKDIR_NAME;
    });
}

/** Anade la entrada al `.gitignore` si no esta, y dice si la anadio. */
function ensureIgnored(workspace: string): boolean {
  const path = join(workspace, '.gitignore');
  if (isIgnored(workspace)) return false;

  if (!existsSync(path)) {
    writeFileSync(path, `${WORKDIR_NAME}/\n`, 'utf8');
    return true;
  }

  const current = readFileSync(path, 'utf8');
  const separator = current.endsWith('\n') || current === '' ? '' : '\n';
  writeFileSync(path, `${current}${separator}${WORKDIR_NAME}/\n`, 'utf8');
  return true;
}

/**
 * El arbol que sigue un proyecto.
 *
 * Si el directorio de trabajo tiene nodos, esos mandan: son la configuracion
 * local del proyecto. Si no, se usa el arbol que trae la skill.
 */
export function treeDirFor(
  workspace: string,
  fallback: string,
): { dir: string; source: 'proyecto' | 'skill' } {
  const own = workdirPath(workspace);
  if (existsSync(own) && hasNodes(own)) {
    return { dir: own, source: 'proyecto' };
  }
  return { dir: fallback, source: 'skill' };
}

/** Si el directorio tiene algun markdown: eso ya es un arbol. */
function hasNodes(dir: string): boolean {
  try {
    return readdirSync(dir).some((name) => name.endsWith('.md'));
  } catch {
    return false;
  }
}
