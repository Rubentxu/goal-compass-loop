/**
 * Contrato entre el proceso que guarda viva la conexion con el host y quien
 * le pide crear un objetivo.
 *
 * Los dos se hablan por un socket local, con una linea JSON por mensaje. El
 * protocolo es deliberadamente pequeno: un ping para saber si el proceso
 * sigue en pie, las cuatro operaciones sobre el objetivo y una salida.
 *
 * El socket se nombra con un resumen del identificador de la sesion: los
 * nombres de socket tienen un limite de longitud corto y el identificador de
 * sesion es largo.
 */
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { stateRoot } from '../adapters/journal.js';
import type { GoalState } from '../core/types.js';

/** Lo que se puede pedir al proceso vivo. */
export type KeeperAction = 'ping' | 'create' | 'read' | 'pause' | 'resume' | 'clear' | 'close';

/** Peticion del cliente al proceso vivo. */
export interface KeeperRequest {
  action: KeeperAction;
  objective?: string;
  tokenBudget?: number;
}

/** Respuesta del proceso vivo al cliente. */
export interface KeeperResponse {
  ok: boolean;
  /** Si el proceso ya tiene la sesion cargada en el host. */
  ready?: boolean;
  goal?: GoalState | null;
  cleared?: boolean;
  error?: string;
}

const ACTIONS: readonly string[] = ['ping', 'create', 'read', 'pause', 'resume', 'clear', 'close'];

/** Ruta del socket que sirve una sesion. */
export function keeperSocketPath(sessionId: string): string {
  const id = createHash('sha256').update(sessionId).digest('hex').slice(0, 12);
  return join(stateRoot(), 'keepers', `k-${id}.sock`);
}

/** Interpreta una linea del protocolo. */
export function parseKeeperRequest(line: string): KeeperRequest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;

  const candidate = parsed as Record<string, unknown>;
  const action = candidate.action;
  if (typeof action !== 'string' || !ACTIONS.includes(action)) return null;

  const request: KeeperRequest = { action: action as KeeperAction };
  if (typeof candidate.objective === 'string') request.objective = candidate.objective;
  if (typeof candidate.tokenBudget === 'number' && Number.isFinite(candidate.tokenBudget)) {
    request.tokenBudget = candidate.tokenBudget;
  }
  return request;
}
