/**
 * Ledger de trabajo ya ejecutado.
 *
 * El fichero de misión declara lo que hay que hacer. Con los ciclos, el
 * workspace necesita anotar también lo que ya se hizo: sin ese registro, la
 * cadena vuelve a ofrecer trabajo que ya está pagado, porque el estado interno
 * solo conoce las intenciones que el propio encadenador encadenó.
 *
 * El ledger es opcional: si el fichero no lo trae, no hay nada ejecutado y la
 * cadena se comporta como antes.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalize } from '../core/types.js';
import { MISSION_FILE_NAME } from './mission.js';

/** Una entrada del ledger: qué se hizo y con qué identificador. */
export interface ExecutedEntry {
  candidateId: string;
  objective: string;
}

/** Objectives ya ejecutados, normalizados para comparar sin depender del texto exacto. */
export type CompletedObjectives = ReadonlySet<string>;

/**
 * Lee el ledger de un fichero de misión.
 *
 * Nunca lanza: un fichero ilegible o sin ledger se lee como un ledger vacío.
 * Un ledger que no se puede leer no puede decir qué está hecho, y adivinarlo
 * sería peor que no saberlo.
 */
export function readExecutedLedger(missionPath: string): ExecutedEntry[] {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(missionPath, 'utf8')) as unknown;
  } catch {
    return [];
  }
  if (typeof raw !== 'object' || raw === null) return [];
  const list = (raw as Record<string, unknown>).executed;
  if (!Array.isArray(list)) return [];

  const entries: ExecutedEntry[] = [];
  for (const item of list) {
    if (typeof item !== 'object' || item === null) continue;
    const record = item as Record<string, unknown>;
    const objective = record.objective;
    if (typeof objective !== 'string' || objective.trim() === '') continue;
    entries.push({
      candidateId: typeof record.candidateId === 'string' ? record.candidateId : '',
      objective,
    });
  }
  return entries;
}

/** Los objetivos ya ejecutados, en forma comparable. */
export function completedObjectives(missionPath: string): CompletedObjectives {
  return new Set(readExecutedLedger(missionPath).map((entry) => normalize(entry.objective)));
}

/**
 * El ledger de un workspace, por su raíz.
 *
 * Es el caso normal: el fichero de la misión vive en la raíz del trabajo que
 * se quiere encadenar.
 */
export function workspaceCompletedObjectives(workspace: string): CompletedObjectives {
  return completedObjectives(join(workspace, MISSION_FILE_NAME));
}

/**
 * Si un objetivo ya se ejecutó.
 *
 * La comparación es por intención normalizada: el mismo trabajo escrito con
 * otras palabras es el mismo trabajo, y volver a ofrecerlo es la forma
 * silenciosa de perder un ciclo.
 */
export function isCompleted(completed: CompletedObjectives, objective: string): boolean {
  return completed.has(normalize(objective));
}
