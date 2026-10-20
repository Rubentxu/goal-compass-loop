/**
 * Carga y validacion de la configuracion de la mision.
 *
 * El fichero de mision describe la intencion durable y los limites; el journal
 * (fuera del repo) describe el estado de ejecucion. Este modulo solo lee.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Candidate, Driver, Mission } from '../core/types.js';

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
