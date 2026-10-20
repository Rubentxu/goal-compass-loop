/**
 * Carga y validacion de la configuracion de la mision.
 *
 * El fichero de mision describe la intencion durable y los limites; el journal
 * (fuera del repo) describe el estado de ejecucion. Este modulo solo lee.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import type { Candidate, Driver, Mission } from '../core/types.js';

/** Nombre del fichero donde se declara la misión. */
export const MISSION_FILE_NAME = 'goal-compass.json';

export interface MissionConfig {
  missionId: string;
  objective: string;
  workspace: string;
  defaultTokenBudget: number;
  totalTokenBudget: number | null;
  maxGoals: number | null;
  stallTimeoutMs: number;
  explorationEnabled: boolean;
  explorationCooldownMs: number;
  allowRemoteWrite: boolean;
  /**
   * Camino que conduce la mision, cuando se declara.
   *
   * Sin declaracion, lo toma el primero que actue y el otro se aparta.
   */
  driver?: Driver | undefined;
  backlog: Candidate[];
}

const DEFAULT_TOKEN_BUDGET = 120_000;
const DEFAULT_STALL_TIMEOUT_MS = 45 * 60_000;
const DEFAULT_EXPLORATION_COOLDOWN_MS = 30 * 60_000;

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`mision: el campo "${field}" debe ser una cadena no vacia`);
  }
  return value;
}

function parseCandidate(raw: unknown, index: number): Candidate {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`mision: backlog[${index}] no es un objeto`);
  }
  const c = raw as Record<string, unknown>;
  const candidateId = requireString(c.candidateId, `backlog[${index}].candidateId`);
  const objective = requireString(c.objective, `backlog[${index}].objective`);
  const evidenceRefs = Array.isArray(c.evidenceRefs) ? c.evidenceRefs.map(String) : [];
  const doneWhen = Array.isArray(c.doneWhen) ? c.doneWhen.map(String) : [];
  const prerequisites = Array.isArray(c.prerequisites) ? c.prerequisites.map(String) : [];
  const risk = c.risk;
  const source = c.source;
  const priority = typeof c.priority === 'number' ? c.priority : 0;

  return {
    candidateId,
    objective,
    whyNow: typeof c.whyNow === 'string' ? c.whyNow : '',
    evidenceRefs,
    doneWhen,
    ...(typeof c.scope === 'string' ? { scope: c.scope } : {}),
    risk: risk === 'low' || risk === 'medium' || risk === 'high' ? risk : 'medium',
    priority,
    prerequisites,
    source:
      source === 'observed' || source === 'roadmap' || source === 'investigation'
        ? source
        : 'observed',
    ...(typeof c.tokenBudget === 'number' ? { tokenBudget: c.tokenBudget } : {}),
  };
}

/** Lee y valida el fichero de mision. */
export function loadMissionConfig(
  path: string,
  overrides?: { workspace?: string },
): MissionConfig {
  const absolute = resolve(path);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(absolute, 'utf8'));
  } catch (err) {
    throw new Error(`mision: no se pudo leer ${absolute}: ${(err as Error).message}`);
  }
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`mision: ${absolute} no contiene un objeto JSON`);
  }
  const c = raw as Record<string, unknown>;

  const backlogRaw = Array.isArray(c.backlog) ? c.backlog : [];
  const maxGoalsRaw = c.maxGoals;
  const totalTokenBudgetRaw = c.totalTokenBudget;
  // El workspace puede venir dado: si el fichero vive dentro del workspace
  // que describe, no hace falta repetirlo.
  const workspace =
    overrides?.workspace ?? (typeof c.workspace === 'string' ? c.workspace : undefined);

  return {
    missionId: requireString(c.missionId, 'missionId'),
    objective: requireString(c.objective, 'objective'),
    workspace: resolve(requireString(workspace, 'workspace')),
    defaultTokenBudget:
      typeof c.defaultTokenBudget === 'number' && c.defaultTokenBudget > 0
        ? c.defaultTokenBudget
        : DEFAULT_TOKEN_BUDGET,
    totalTokenBudget:
      typeof totalTokenBudgetRaw === 'number' && totalTokenBudgetRaw > 0 ? totalTokenBudgetRaw : null,
    maxGoals: typeof maxGoalsRaw === 'number' && maxGoalsRaw > 0 ? maxGoalsRaw : null,
    stallTimeoutMs:
      typeof c.stallTimeoutMs === 'number' && c.stallTimeoutMs > 0
        ? c.stallTimeoutMs
        : DEFAULT_STALL_TIMEOUT_MS,
    explorationEnabled: c.explorationEnabled !== false,
    explorationCooldownMs:
      typeof c.explorationCooldownMs === 'number' && c.explorationCooldownMs > 0
        ? c.explorationCooldownMs
        : DEFAULT_EXPLORATION_COOLDOWN_MS,
    allowRemoteWrite: c.allowRemoteWrite === true,
    ...(c.driver === 'supervisor' || c.driver === 'plugin' ? { driver: c.driver } : {}),
    backlog: backlogRaw.map(parseCandidate),
  };
}

/** Lo que hay que saber para escribir una declaracion de mision. */
export interface DeclarationOptions {
  missionId: string;
  objective: string;
  driver: Driver;
  defaultTokenBudget: number;
  totalTokenBudget: number | null;
  allowRemoteWrite: boolean;
}

/**
 * El identificador por defecto de una mision.
 *
 * Se compone del nombre del proyecto y una huella corta de su ruta. El
 * nombre lo hace legible y la huella evita que dos proyectos con el mismo
 * nombre compartan el mismo estado durable, que es un fallo silencioso: las
 * dos misiones se pisarian sin dar error.
 */
export function defaultMissionId(workspace: string): string {
  const absolute = resolve(workspace);
  const slug =
    basename(absolute)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'mision';
  const fingerprint = createHash('sha256').update(absolute).digest('hex').slice(0, 4);
  return `${slug}-${fingerprint}`;
}

/**
 * Escribe la declaracion de una mision.
 *
 * No pisa una declaracion que ya existe: un fichero de mision escrito a mano
 * vale mas que uno generado, y pisarlo seria una perdida silenciosa.
 */
export function writeMissionDeclaration(path: string, options: DeclarationOptions): void {
  if (existsSync(path)) {
    throw new Error(`ya hay una declaracion de mision en ${path}: no se toca`);
  }

  const declaration = {
    missionId: options.missionId,
    objective: options.objective,
    defaultTokenBudget: options.defaultTokenBudget,
    totalTokenBudget: options.totalTokenBudget,
    explorationEnabled: true,
    allowRemoteWrite: options.allowRemoteWrite,
    driver: options.driver,
    backlog: [],
  };

  writeFileSync(path, `${JSON.stringify(declaration, null, 2)}\n`, 'utf8');
}

/**
 * Donde vive la declaracion de la mision de un workspace.
 */
export function missionDeclarationPath(workspace: string): string {
  return resolve(workspace, MISSION_FILE_NAME);
}

/** Lo que se puede pedir al declarar una mision. */
export interface DeclareMissionOptions {
  /** Identificador con el que se quiere llamar a la mision. */
  missionId?: string | undefined;
  /** Que se quiere conseguir con ella. */
  objective: string;
  /** Que camino la conduce. */
  driver?: Driver | undefined;
  /** Tokens por objetivo. */
  defaultTokenBudget?: number | undefined;
  /** Tokens para la mision completa. */
  totalTokenBudget?: number | null | undefined;
  /** Si la mision autoriza publicar. */
  allowRemoteWrite?: boolean | undefined;
}

/** Como queda una mision declarada. */
export interface DeclaredMission {
  /** Donde esta la declaracion. */
  path: string;
  /** Identificador de la mision. */
  missionId: string;
  /** Objetivo declarado. */
  objective: string;
  /** Camino que conduce la mision. */
  driver: Driver;
  /** Si la declaracion se ha escrito ahora o ya estaba ahi. */
  created: boolean;
}

/**
 * Declara la mision de un workspace.
 *
 * Es idempotente: si ya hay una declaracion, no la toca y devuelve la que
 * hay. Un agente que la declara dos veces por error no rompe nada, y una
 * declaracion escrita a mano nunca se pierde por detrás de la herramienta.
 */
export function declareMission(
  workspace: string,
  options: DeclareMissionOptions,
): DeclaredMission {
  const root = resolve(workspace);
  const path = missionDeclarationPath(root);

  if (existsSync(path)) {
    const current = readDeclaration(path);
    return { path, ...current, created: false };
  }

  const missionId = options.missionId ?? defaultMissionId(root);
  const driver = options.driver ?? 'plugin';
  const objective = options.objective.trim();

  writeMissionDeclaration(path, {
    missionId,
    objective,
    driver,
    defaultTokenBudget: options.defaultTokenBudget ?? DEFAULT_TOKEN_BUDGET,
    totalTokenBudget: options.totalTokenBudget ?? null,
    allowRemoteWrite: options.allowRemoteWrite === true,
  });

  return { path, missionId, objective, driver, created: true };
}

/**
 * Lee lo esencial de una declaracion sin exigir que sea completa.
 *
 * Una declaracion a medio hacer tiene que poder leerse: el objetivo es
 * decir que hay una mision ahi y como se llama, no validar el resto.
 */
export function readDeclaration(path: string): {
  missionId: string;
  objective: string;
  driver: Driver;
} {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return { missionId: '', objective: '', driver: 'plugin' };
  }
  if (typeof raw !== 'object' || raw === null) {
    return { missionId: '', objective: '', driver: 'plugin' };
  }
  const c = raw as Record<string, unknown>;
  return {
    missionId: typeof c.missionId === 'string' ? c.missionId : '',
    objective: typeof c.objective === 'string' ? c.objective : '',
    driver: c.driver === 'supervisor' ? 'supervisor' : 'plugin',
  };
}

/**
 * Si dos rutas apuntan al mismo sitio.
 *
 * Las rutas se comparan ya resueltas: un enlace simbolico y su destino son el
 * mismo directorio, y cada quien da el que conoce.
 */
export function sameWorkspace(a: string, b: string): boolean {
  if (resolve(a) === resolve(b)) return true;
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return false;
  }
}

/** Convierte la configuracion en el estado de mision inicial. */
export function toMission(config: MissionConfig): Mission {
  return {
    missionId: config.missionId,
    objective: config.objective,
    status: 'running',
    defaultTokenBudget: config.defaultTokenBudget,
    totalTokenBudget: config.totalTokenBudget,
    maxGoals: config.maxGoals,
    stallTimeoutMs: config.stallTimeoutMs,
    explorationEnabled: config.explorationEnabled,
    explorationCooldownMs: config.explorationCooldownMs,
    workspace: config.workspace,
    backlog: config.backlog,
    allowRemoteWrite: config.allowRemoteWrite,
  };
}
