/**
 * Tipos del dominio.
 *
 * Reflejan la forma real de los datos que llegan del host y la forma en que el
 * nucleo razona sobre ellos. No dependen de ningun transporte concreto.
 */

/** Estados en los que puede estar un Goal. */
export type GoalStatus =
  | 'active'
  | 'paused'
  | 'blocked'
  | 'complete'
  | 'budget_limited'
  | 'usage_limited';

/** Estados de Goal que NO autorizan crear el siguiente. */
export const NON_SUCCESS_GOAL_STATUSES: readonly GoalStatus[] = [
  'paused',
  'blocked',
  'budget_limited',
  'usage_limited',
];

/** Verificacion final del Goal, cuando el runtime la ha ejecutado. */
export interface GoalVerification {
  backend?: string;
  verdict?: string;
  reason?: string;
  missing?: string[];
  notMetStreak?: number;
  at?: number;
}

/** Estado completo de un Goal, tal y como lo devuelve el host. */
export interface GoalState {
  goalId: string;
  sessionId: string;
  objective: string;
  status: GoalStatus;
  createdAt: number;
  updatedAt: number;
  tokensUsed: number;
  turnsUsed: number;
  timeUsedSeconds: number;
  tokenBudget?: number | undefined;
  statusReason: string | null;
  executionWait: unknown;
  hasKickoffAttachments: boolean;
  lastVerification?: GoalVerification | null;
}

/** Proposito de un candidato a Goal. */
export interface Candidate {
  candidateId: string;
  objective: string;
  whyNow: string;
  evidenceRefs: string[];
  doneWhen: string[];
  scope?: string | undefined;
  risk: 'low' | 'medium' | 'high';
  priority: number;
  prerequisites: string[];
  source: 'observed' | 'roadmap' | 'investigation';
  tokenBudget?: number | undefined;
}

/** Quien conduce la cadena de objetivos de una mision. */
export type Driver = 'supervisor' | 'plugin';

/** Nivel de la mision, persistente e independiente del Goal. */
export type MissionStatus =
  | 'running'
  | 'parked'
  | 'paused_by_user'
  | 'stopped_by_user'
  | 'escalated';

/** Configuracion de la mision: intencion durable + limites. */
export interface Mission {
  missionId: string;
  objective: string;
  status: MissionStatus;
  /** Limite de tokens por Goal creado. */
  defaultTokenBudget: number;
  /** Limite de tokens acumulados en toda la mision. `null` = sin limite. */
  totalTokenBudget: number | null;
  /** Limite de Goals encadenados en una misma sesion. `null` = sin limite. */
  maxGoals: number | null;
  /** Milisegundos sin avance antes de dar la mision por estancada. */
  stallTimeoutMs: number;
  /** Autorizado a pedir una exploracion cuando no hay trabajo elegible. */
  explorationEnabled: boolean;
  /** Milisegundos entre exploraciones, para no repetir la misma consulta. */
  explorationCooldownMs: number;
  /** Raiz del workspace donde se ejecuta el Goal. */
  workspace: string;
  /** Backlog conocido, en orden de preferencia del autor. */
  backlog: Candidate[];
  /** Razon del estado `parked` o `escalated`. */
  reason?: string | undefined;
  /** Autorizado a empujar / publicar / desplegar. */
  allowRemoteWrite: boolean;
  /**
   * Camino que esta conduciendo la cadena.
   *
   * `undefined` significa que todavia nadie la ha tomado. Se escribe para que
   * quede a la vista quien manda y para que el otro camino se aparte.
   */
  driver?: Driver | undefined;
  /** Cuando se tomo el mando por ultima vez, para saber si sigue vigente. */
  driverAt?: number | undefined;
}

/** Intencion de transicion persistida ANTES de llamar a `goal/create`. */
export interface TransitionIntent {
  intentId: string;
  candidateId: string;
  /** Clave estable del candidato: permite reconocerlo aunque el backlog cambie. */
  candidateKey: string;
  objective: string;
  tokenBudget: number | undefined;
  createdAt: string;
  status: 'intent' | 'committed' | 'obsolete';
  goalId?: string | undefined;
}

/** Registro historico de un Goal ya terminado, con su prueba. */
export interface GoalRecord {
  goalId: string;
  objective: string;
  status: GoalStatus;
  statusReason: string | null;
  tokensUsed: number;
  turnsUsed: number;
  startedAt: number;
  endedAt: number;
  candidateId: string | undefined;
  /** Clave estable del candidato (`candidateKey`): deduplica por intencion, no por texto. */
  candidateKey: string | undefined;
  receipt: string | undefined;
}

/** Ultimo avance observado del Goal en curso, para detectar estancamiento. */
export interface GoalProgress {
  goalId: string;
  /** Firma del estado: cambia cuando el Goal avanza de verdad. */
  signature: string;
  /** Momento en el que se observo ese estado. */
  since: number;
}

/** Estado durable del supervisor. */
export interface Journal {
  version: 1;
  missionId: string;
  sessionId: string | undefined;
  mission: Mission;
  goals: GoalRecord[];
  intents: TransitionIntent[];
  progress: GoalProgress | undefined;
  /** Candidatos propuestos por la exploracion y aun no consumidos. */
  explored: Candidate[];
  /** Exploraciones seguidas sin resultado: alargan el enfriamiento. */
  explorationStreak: number;
  /** Momento de la ultima exploracion, para respetar el enfriamiento. */
  lastExplorationAt: number | undefined;
  updatedAt: string;
}

/**
 * Canal de control del usuario. Vive en un fichero aparte del journal para que
 * el supervisor (unico escritor del journal) no pise la orden del usuario.
 */
export interface MissionControl {
  status: MissionStatus;
  reason?: string | undefined;
  updatedAt?: string | undefined;
}

/**
 * Snapshot inmutable: la unica entrada del nucleo puro.
 * `decide()` no produce efectos; solo decide.
 */
export interface Snapshot {
  mission: Mission;
  /** Goal actual de la sesion, o null si todavia no hay. */
  goal: GoalState | null;
  /** Candidatos conocidos por la mision (el nucleo filtra los elegibles). */
  candidates: Candidate[];
  /** Intencion de transicion aun sin confirmar (posible crash a mitad). */
  pendingIntent: TransitionIntent | null;
  /** GoalIds ya completados en esta mision. */
  completedGoalIds: string[];
  /** candidateIds ya completados (satisfechos). */
  completedCandidateIds: string[];
  /** Claves estables (`candidateKey`) ya completadas: deduplica por intencion, no por texto. */
  completedCandidateKeys: string[];
  /** Numero de Goals ya encadenados en esta mision. */
  goalsCreated: number;
  /** Tokens gastados por la mision hasta ahora, sumando los Goals ya terminados. */
  tokensUsedTotal: number;
  /** Milisegundos desde el ultimo avance observado del Goal en curso. */
  goalProgressSince: number | null;
  /** Marca temporal para decisiones dependientes del tiempo. */
  now: number;
}

/**
 * Decision del nucleo puro. El adaptador la ejecuta.
 *
 * - `create`  : hay que crear un Goal nuevo (el anterior esta `complete`).
 * - `reconcile`: hay una intencion sin confirmar; hay que reconciliar con el host.
 * - `park`    : no hay trabajo util; la mision queda viva pero dormida.
 * - `wait`    : el Goal actual sigue vivo o el host impose un limite.
 * - `escalate`: conflicto de autoridad u otra situacion que exige humano.
 */
export type Decision =
  | { kind: 'create'; candidate: Candidate; reason: string }
  | { kind: 'reconcile'; intent: TransitionIntent; reason: string }
  | { kind: 'park'; reason: string }
  | { kind: 'wait'; reason: string }
  | { kind: 'escalate'; reason: string };

/** Clave estable de deduplicacion: intencion + alcance + criterio. */
export function candidateKey(candidate: Candidate): string {
  return [
    normalize(candidate.objective),
    normalize(candidate.scope ?? ''),
    candidate.doneWhen.map(normalize).sort().join('|'),
  ].join('::');
}

/** Normaliza texto para comparar claves sin depender de mayusculas ni espacios. */
export function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}
