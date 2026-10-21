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
  /**
   * Libera el objetivo de la sesion.
   *
   * El host guarda un unico objetivo por sesion, asi que un objetivo que no
   * ha terminado impide crear el siguiente. Vaciarlo es lo que permite
   * reencolar el mismo trabajo con mas presupuesto.
   */
  clear(sessionId: string): Promise<boolean>;
  /** SessionId de la sesion gestionada por este supervisor. */
  sessionId(): string;
  /** Cierra host y recursos. */
  close(): Promise<void>;
}

/**
 * Adaptador de objetivos: el puerto de arriba y ademas el arranque.
 *
 * El supervisor solo necesita saber leer y crear objetivos; como se llega al
 * host es cosa del adaptador. Un adaptador puede hablar con el host en frio,
 * con una conexion que ya esta viva o con lo que haga falta: el supervisor no
 * cambia.
 */
export interface GoalAdapter extends GoalPort {
  /** Prepara el adaptador para trabajar: conectar y dejar la sesion lista. */
  start(): Promise<void>;
  /** Pregunta al agente de la sesion. */
  ask(question: string): Promise<string>;
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

/**
 * Candado exclusivo para la ventana en la que se encadena un objetivo.
 *
 * Dos caminos pueden ver el objetivo terminado en el mismo instante: el
 * cierre de turno del agente y el sondeo del supervisor. Sin este candado,
 * ambos crearian el siguiente y uno se quedaria huerfano con sus tokens
 * gastados.
 */
export interface ChainLockPort {
  /** Toma el candado y devuelve como soltarlo, o `null` si hay otra via. */
  acquire(now?: number): ChainLockHandle | null;
}

/**
 * El candado, con suelta y valla.
 *
 * Se suelta como una funcion, para que el contrato de siempre no cambie. Lo que
 * anade son las dos preguntas que un candado mudo no sabe responder: si sigue
 * siendo nuestro —y por tanto si su dueno puede escribir todavia— y si puede
 * renovar la gracia mientras trabaja.
 */
export interface ChainLockHandle {
  /** Suelta el candado. */
  (): void;
  /** Si el candado sigue siendo de este proceso. */
  valid(): boolean;
  /** Renueva el candado mientras siga siendo nuestro. */
  renew(now?: number): void;
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
