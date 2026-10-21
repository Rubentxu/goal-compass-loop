/**
 * Cuando hay que empujar a una sesion para que la cadena siga.
 *
 * El plugin solo reacciona a eventos del host, y el evento fiable es el fin de
 * turno. Cuando un turno termina y el trabajo se encadena, todo va bien: hay
 * sesion viva, el objetivo se abre y el agente lo trabaja. El problema es el
 * contrario —un objetivo que se queda quieto con la sesion todavia por ahi— y
 * ahi no pasa nada. Nadie cierra un turno, asi que el plugin no se entera.
 *
 * Esto no arregla la cadena: le habla. La sesion ya esta abierta y el host
 * acepta un prompt nuevo en una sesion existente, asi que basta con escribirle
 * para que un turno vuelva a empezar. Como el prompt entra por la sesion, el
 * hook de fin de turno se dispara solo y el encadenado sigue su curso.
 *
 * Que se inyecte no significa que la cadena este rota: significa que la
 * sesion se ha quedado esperando y hay trabajo de verdad esperandola.
 */
import type { MissionStatus } from './types.js';

/** Margen sin avance antes de dar la sesion por dormida. */
export const DEFAULT_NUDGE_STALL_MS = 10 * 60_000;

/** Tiempo que se respeta tras empujar, para no insistir sobre lo mismo. */
export const DEFAULT_NUDGE_COOLDOWN_MS = 15 * 60_000;

/** Lo que hay que saber para decidir si se empuja. */
export interface NudgeSnapshot {
  /** Estado de la cadena. Quien la detiene, manda. */
  missionStatus: MissionStatus;
  /** `estado|turnos|tokens` del objetivo en curso, si lo hay. */
  goalSignature: string | undefined;
  /** Cuando cambio esa firma por ultima vez. */
  goalProgressSince: number | null;
  /** Si hay trabajo elegible al que dar entrada. */
  hasEligibleWork: boolean;
  /** Cuando se empujo por ultima vez. */
  lastNudgeAt: number | null;
  now: number;
  stallTimeoutMs: number;
  cooldownMs: number;
}

/** Que hacer con la sesion. */
export interface NudgeVerdict {
  nudge: boolean;
  reason: string;
}

/**
 * Decide si la sesion necesita un empujon.
 *
 * El orden importa: primero quien manda, despues lo que ya se ha probado y
 * solo al final si el trabajo quieto es real. Empujar a una cadena que el
 * usuario ha parado seria ignorarlo, y empujar sin trabajo seria gastar un
 * turno en nada.
 */
export function decideNudge(snapshot: NudgeSnapshot): NudgeVerdict {
  const { missionStatus, goalSignature, goalProgressSince, hasEligibleWork } = snapshot;

  if (missionStatus === 'stopped_by_user' || missionStatus === 'paused_by_user') {
    return { nudge: false, reason: `la cadena esta ${missionStatus}: no se empuja` };
  }
  if (missionStatus === 'escalated') {
    return { nudge: false, reason: 'la cadena necesita a alguien: no se empuja' };
  }

  if (!goalSignature || goalProgressSince === null) {
    return { nudge: false, reason: 'no hay ningun objetivo en curso que este quieto' };
  }

  if (
    snapshot.lastNudgeAt !== null &&
    snapshot.now - snapshot.lastNudgeAt < snapshot.cooldownMs
  ) {
    return { nudge: false, reason: 'se ha empujado hace poco y no hay novedad' };
  }

  if (!hasEligibleWork) {
    return { nudge: false, reason: 'no hay trabajo elegible al que dar entrada' };
  }

  const quieto = snapshot.now - goalProgressSince;
  if (quieto < snapshot.stallTimeoutMs) {
    return { nudge: false, reason: 'el objetivo avanza o todavia no lleva demasiado rato quieto' };
  }

  const minutos = Math.floor(quieto / 60_000);
  return {
    nudge: true,
    reason: `el objetivo lleva ${minutos} minuto(s) sin cambiar y hay trabajo esperando`,
  };
}