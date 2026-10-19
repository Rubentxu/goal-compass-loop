/**
 * Ports: los efectos que el nucleo puro no puede tener.
 * El nucleo no importa nada de aqui; los adaptadores implementan estos tipos.
 */
import type { Candidate, GoalState, Journal, Mission } from './core/types.js';

export interface GoalPort {
  /** Estado actual del Goal de la sesion, o null si no hay. */
  read(sessionId: string): Promise<GoalState | null>;
  /** Crea un Goal nuevo. Lanza si el host lo rechaza. */
  create(
    sessionId: string,
    objective: string,
    tokenBudget: number | undefined,
  ): Promise<GoalState>;
  /** Pausa el Goal en curso para que deje de consumir presupuesto. */
  pause(sessionId: string): Promise<GoalState | null>;
  /** Reanuda un Goal pausado. */
  resume(sessionId: string): Promise<GoalState | null>;
  /** SessionId de la sesion gestionada por este supervisor. */
  sessionId(): string;
  /** Cierra host y recursos. */
  close(): Promise<void>;
}

export interface CandidatePort {
  /** Candidatos conocidos para la mision, dados el Goal anterior. */
  discover(mission: Mission, previousGoal: GoalState | null): Promise<Candidate[]>;
}

/**
 * Exploracion acotada: se consulta al agente del host por trabajo que las
 * fuentes deterministas no ven. Lo que devuelve pasa el mismo filtro que el
 * resto de candidatos, y solo se admite si su evidencia es real.
 */
export interface ExplorationPort {
  explore(mission: Mission, previousGoal: GoalState | null): Promise<Candidate[]>;
}

/** Sesion de texto con la que preguntar al agente del host. */
export interface TextSession {
  ask(question: string): Promise<string>;
}

export interface JournalPort {
  load(): Promise<Journal | null>;
  saveAtomically(journal: Journal): Promise<void>;
}

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface Clock {
  now(): number;
}

/** Error de compatibilidad: el host no ofrece la extension de Goal. */
export class IncompatibleHostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IncompatibleHostError';
  }
}
