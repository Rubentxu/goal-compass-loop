/**
 * Carga y validacion de la configuracion de la mision.
 *
 * El fichero de mision describe la intencion durable y los limites; el journal
 * (fuera del repo) describe el estado de ejecucion. Este modulo solo lee.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Candidate, Mission } from '../core/types.js';

export interface MissionConfig {
  missionId: string;
  objective: string;
  workspace: string;
  defaultTokenBudget: number;
  totalTokenBudget: number | null;
  maxGoals: number | null;
  allowRemoteWrite: boolean;
  backlog: Candidate[];
}

const DEFAULT_TOKEN_BUDGET = 120_000;

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
export function loadMissionConfig(path: string): MissionConfig {
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

  return {
    missionId: requireString(c.missionId, 'missionId'),
    objective: requireString(c.objective, 'objective'),
    workspace: resolve(requireString(c.workspace, 'workspace')),
    defaultTokenBudget:
      typeof c.defaultTokenBudget === 'number' && c.defaultTokenBudget > 0
        ? c.defaultTokenBudget
        : DEFAULT_TOKEN_BUDGET,
    totalTokenBudget:
      typeof totalTokenBudgetRaw === 'number' && totalTokenBudgetRaw > 0 ? totalTokenBudgetRaw : null,
    maxGoals: typeof maxGoalsRaw === 'number' && maxGoalsRaw > 0 ? maxGoalsRaw : null,
    allowRemoteWrite: c.allowRemoteWrite === true,
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
    workspace: config.workspace,
    backlog: config.backlog,
    allowRemoteWrite: config.allowRemoteWrite,
  };
}
