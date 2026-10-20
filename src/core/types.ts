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

/**
 * Estados en los que el objetivo se ha quedado sin margen para seguir.
 *
 * No son un veredicto sobre el trabajo: solo dicen que se agotó el espacio
 * que se le había dado. Por eso se reintentan con más presupuesto en lugar de
 * dejar la cadena esperando.
 */
export const BUDGET_EXHAUSTED_GOAL_STATUSES: readonly GoalStatus[] = [
  'budget_limited',
  'usage_limited',
];

/**
 * Cuantos intentos se le dan a un trabajo antes de dejarlo para un humano.
 *
 * El presupuesto se dobla en cada intento, asi que la secuencia habitual es
 * 120k, 240k y 480k tokens. A partir del cuarto intento, el trabajo se aparca:
 * repetir sin limite gastaria tokens sin avanzar.
 */
export const MAX_BUDGET_ATTEMPTS = 3;

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
  /**
   * El objetivo que pidio el trabajo, tal cual.
   *
   * Es lo que se lee y lo que se compara; lo que recibe el host es
   * `hostObjective`, que lleva dentro la evidencia y el criterio de cierre.
   */
  objective: string;
  /**
   * El objetivo tal y como se le da al host.
   *
   * Lleva dentro la evidencia y el criterio de cierre del candidato, porque
   * el Goal se autoejecuta y su arranque solo lleva este texto.
   */
  hostObjective: string;
  /** De donde sale el trabajo: los ficheros que lo piden. */
  evidenceRefs: string[];
  /** Como se sabra que esta hecho. */
  doneWhen: string[];
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
  /** De donde salio el trabajo: los ficheros que lo piden. */
  evidenceRefs?: string[];
  /** Como se sabe que esta hecho. */
  doneWhen?: string[];
  receipt: string | undefined;
}

/**
 * Un trabajo que se quedo sin presupuesto, con lo que le costo.
 *
 * Es el rastro de los reintentos: que trabajo se quedo corto, cuanto se le
 * habia dado, cuanto gasto y en que intento estaba.
 */
export interface BudgetAttempt {
  /** Clave estable del trabajo reintentado. */
  candidateKey: string;
  /** Identificador del trabajo reintentado. */
  candidateId: string;
  /** Objetivo que se quedo sin margen. */
  goalId: string;
  /** Numero de intento: el primero es el 1. */
  attempt: number;
  /** Presupuesto que se le concedio en este intento. */
  tokenBudget: number;
  /** Tokens gastados en este intento. */
  tokensUsed: number;
  /** Momento en que se constato el agotamiento. */
  endedAt: number;
}

/**
 * Medidas de la mision.
 *
 * El presupuesto informa, no manda: que se pase no detiene la cadena, pero
 * queda a la vista para que se sepa cuanto ha costado el trabajo.
 */
export interface MissionMetrics {
  /** Tokens gastados por los objetivos de la cadena. */
  tokensUsed: number;
  /** El presupuesto declarado de la mision se ha superado. */
  budgetExceeded: boolean;
  /** Cuantos intentos se han quedado sin presupuesto. */
  budgetExhaustions: number;
  /** Cuantos objetivos se han encadenado. */
  goalsCreated: number;
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
  /** Intentos que se quedaron sin presupuesto, con su coste. */
  budgetAttempts: BudgetAttempt[];
  /** Medidas de la mision: cuanto lleva gastado y como va. */
  metrics: MissionMetrics;
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
  /** El objetivo en curso lo creo la cadena (y no el usuario). */
  ownGoal: boolean;
  /** El trabajo que representa el objetivo en curso, si se sabe. */
  goalCandidate: Candidate | null;
  /** Clave estable del trabajo que representa el objetivo en curso. */
  goalCandidateKey: string | null;
  /** Intentos que se quedaron sin presupuesto. */
  budgetAttempts: BudgetAttempt[];
  /** Milisegundos desde el ultimo avance observado del Goal en curso. */
  goalProgressSince: number | null;
  /** Marca temporal para decisiones dependientes del tiempo. */
  now: number;
}

/**
 * Decision del nucleo puro. El adaptador la ejecuta.
 *
 * - `create`  : hay que crear un Goal nuevo (el anterior esta `complete`).
 * - `retry`   : el objetivo se quedo sin presupuesto; el mismo trabajo se
 *               vuelve a encolar con el presupuesto doblado.
 * - `reconcile`: hay una intencion sin confirmar; hay que reconciliar con el host.
 * - `park`    : no hay trabajo util; la mision queda viva pero dormida.
 * - `wait`    : el Goal actual sigue vivo o el host impose un limite.
 * - `escalate`: conflicto de autoridad u otra situacion que exige humano.
 */
export type Decision =
  | { kind: 'create'; candidate: Candidate; reason: string }
  | {
      kind: 'retry';
      candidate: Candidate;
      /** Clave estable del trabajo: mantiene el rastro de los intentos. */
      candidateKey: string;
      /** Presupuesto con el que se reintenta. */
      tokenBudget: number;
      reason: string;
    }
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

/** Medidas de una mision recien abierta. */
export function emptyMetrics(): MissionMetrics {
  return { tokensUsed: 0, budgetExceeded: false, budgetExhaustions: 0, goalsCreated: 0 };
}

/**
 * Completa lo que le falte a un journal escrito por una version anterior.
 *
 * Los journals que ya estaban escritos no tienen intentos ni medidas: se
 * completan al leerlos, para que el estado viejo siga siendo utilizable.
 */
export function normalizeJournal(journal: Journal): Journal {
  const loose = journal as Journal & {
    budgetAttempts?: BudgetAttempt[];
    metrics?: MissionMetrics;
  };
  loose.budgetAttempts ??= [];
  loose.metrics = { ...emptyMetrics(), ...(loose.metrics ?? {}) };
  return journal;
}

/**
 * El objetivo que se le da al host: el trabajo y, con el, de donde sale y
 * como se demuestra.
 *
 * El Goal se autoejecuta: su arranque solo lleva este texto. Si la evidencia
 * y el criterio de cierre se quedan en el candidato, quien trabaja el
 * objetivo tiene que volver a buscarlos, y el criterio —que es lo que decide
 * si el trabajo esta demostrado— no llega nunca a quien tiene que
 * demostrarlo.
 *
 * El texto se mantiene compacto: el host puede imponer un tope de longitud
 * al objetivo, y un trabajo que no se puede crear no avanza.
 *
 * `extra` anade al final lo que quien conduce la mision quiere que el agente
 * sepa: como trabajar, que no puede hacer y donde esta la mision. Va aqui
 * porque el objetivo es lo unico que el host entrega al agente cuando
 * encadena un objetivo nuevo.
 */
export function composeObjective(candidate: Candidate, extra?: readonly string[]): string {
  const lines = [candidate.objective.trim()];

  if (candidate.evidenceRefs.length > 0) {
    lines.push('', `Evidencia: ${candidate.evidenceRefs.join(', ')}`);
  }

  if (candidate.doneWhen.length > 0) {
    lines.push('Criterio de cierre:');
    for (const item of candidate.doneWhen) lines.push(`- ${item}`);
  }

  if (extra && extra.length > 0) {
    lines.push('', ...extra);
  }

  return lines.join('\n');
}
