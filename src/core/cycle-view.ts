/**
 * La vista del ciclo activo: como va la mision ahora mismo, en texto.
 *
 * El estado durable es un JSON en un directorio de estado, y leerlo a mano para
 * saber que objetivo va, cuales están hechos y cuanto queda de presupuesto es
 * trabajo de nadie: el agente que esta trabajando es el unico que lo necesita y
 * lo necesita en cada turno. Por eso la vista se arma aqui, en un modulo puro,
 * y desde ahi la pintan dos caminos distintos: el servidor de herramientas, que
 * la ofrece bajo demanda, y el encadenado automatico, que la lleva dentro del
 * objetivo nuevo para que quien lo recibe sepa donde esta la cadena.
 *
 * Es texto y no un panel porque un plugin no dibuja paneles: la superficie real
 * del host son herramientas, recursos, prompts y la lista de tareas del modelo.
 * Un bloque de texto se copia tal cual a una lista de tareas, y por eso el
 * formato es plano y cada linea dice una sola cosa.
 */
import { normalize, type Driver, type GoalStatus, type Journal, type MissionStatus } from './types.js';

/** Un trabajo pendiente: lo que queda por hacer y de donde sale. */
export interface CycleWorkItem {
  /** Que hay que hacer, en una frase. */
  objective: string;
  /** De donde sale el trabajo: los ficheros que lo piden. */
  evidence: string[];
  /** De donde sale el trabajo. */
  origin: 'backlog' | 'propuesta' | 'exploracion';
}

/** El objetivo en curso, con la evidencia que lo respalda. */
export interface CycleCurrent {
  goalId: string;
  objective: string;
  evidence: string[];
}

/** Un objetivo ya registrado, con el estado con el que termino. */
export interface CycleDone {
  goalId: string;
  objective: string;
  status: GoalStatus;
  tokensUsed: number;
}

/** La vista del ciclo, en forma de datos. */
export interface CycleView {
  missionId: string;
  /** El objetivo de la mision, tal y como se declaro. */
  objective: string;
  /** En que esta la cadena. */
  status: MissionStatus;
  /** Que camino conduce la mision, si alguno. */
  driver: Driver | null;
  /** Por que esta en el estado en que esta, si hay un motivo. */
  reason: string | null;
  /** El objetivo en curso, si lo hay. */
  current: CycleCurrent | null;
  /** Los objetivos ya registrados, con su estado. */
  done: CycleDone[];
  /** El trabajo que queda. */
  pending: CycleWorkItem[];
  /** Tokens gastados por la cadena hasta ahora. */
  tokensUsed: number;
  /** El presupuesto declarado ya se ha superado. */
  budgetExceeded: boolean;
  /** Presupuesto total de la mision, si lo hay. */
  tokenBudget: number | null;
  /** Cuantos objetivos ha encadenado la cadena. */
  goalsCreated: number;
  /** Cuantos intentos se quedaron sin presupuesto. */
  budgetExhaustions: number;
}

/** Lo que quien arma la vista ya sabe y no se deduce del journal. */
export interface CycleViewOptions {
  /** Trabajo ya pagado, por texto normalizado, para no ofrecerlo como pendiente. */
  completed?: ReadonlySet<string>;
  /**
   * Trabajo pendiente ya descubierto.
   *
   * Quien tiene el puerto de candidatos lo sabe mejor que el journal, asi que
   * si viene, manda; si no, se deduce del propio journal.
   */
  pending?: readonly CycleWorkItem[];
}

/**
 * Arma la vista del ciclo a partir del estado durable.
 *
 * El objetivo en curso se busca por el progreso observado: es el unico dato
 * que dice que hay un objetivo vivo ahora mismo. Si todavia no se ha observado
 * ninguno, se mira la intencion a medio confirmar, que es el trabajo que esta
 * en camino de convertirse en objetivo.
 */
export function cycleViewOf(state: Journal, options: CycleViewOptions = {}): CycleView {
  const completed = options.completed ?? new Set<string>();

  return {
    missionId: state.mission.missionId,
    objective: state.mission.objective,
    status: state.mission.status,
    driver: state.mission.driver ?? null,
    reason: state.mission.reason ?? null,
    current: currentWork(state),
    done: state.goals.map((record) => ({
      goalId: record.goalId,
      objective: record.objective,
      status: record.status,
      tokensUsed: record.tokensUsed,
    })),
    pending: pendingWork(state, completed, options.pending),
    tokensUsed:
      state.metrics?.tokensUsed ?? state.goals.reduce((total, goal) => total + goal.tokensUsed, 0),
    budgetExceeded: state.metrics?.budgetExceeded ?? false,
    tokenBudget: state.mission.totalTokenBudget ?? null,
    goalsCreated:
      state.metrics?.goalsCreated ?? state.intents.filter((intent) => intent.status === 'committed').length,
    budgetExhaustions:
      state.metrics?.budgetExhaustions ?? state.budgetAttempts?.length ?? 0,
  };
}

/**
 * El objetivo en curso: el que se ha observado vivo, o el que esta en camino.
 *
 * La evidencia sale de la intencion que lo encadeno, porque ahi queda escrita:
 * el registro del objetivo sabe como termino, pero no de donde salio el trabajo.
 */
function currentWork(state: Journal): CycleCurrent | null {
  const observed = state.progress?.goalId;
  if (observed) {
    const intent = state.intents.find((entry) => entry.goalId === observed);
    if (intent) {
      return {
        goalId: observed,
        objective: intent.objective,
        evidence: intent.evidenceRefs ?? [],
      };
    }
    const record = state.goals.find((entry) => entry.goalId === observed);
    if (record) {
      return {
        goalId: observed,
        objective: record.objective,
        evidence: record.evidenceRefs ?? [],
      };
    }
  }

  const pending = [...state.intents].reverse().find((intent) => intent.status === 'intent');
  if (!pending) return null;
  return {
    goalId: pending.goalId ?? 'sin-confirmar',
    objective: pending.objective,
    evidence: pending.evidenceRefs ?? [],
  };
}

/**
 * El trabajo que queda, sin repetir lo ya pagado ni lo que esta en curso.
 *
 * Un trabajo ya ejecutado que vuelve a la cola es la forma mas cara de perder
 * un ciclo: se vuelve a hacer y se vuelve a pagar. Y el trabajo en curso, si se
 * listara como pendiente, haria que la lista dijera dos veces lo mismo.
 */
function pendingWork(
  state: Journal,
  completed: ReadonlySet<string>,
  discovered: readonly CycleWorkItem[] | undefined,
): CycleWorkItem[] {
  const items: CycleWorkItem[] = discovered
    ? [...discovered]
    : [
        ...state.mission.backlog.map((candidate) => ({
          objective: candidate.objective,
          evidence: candidate.evidenceRefs ?? [],
          origin: 'backlog' as const,
        })),
        ...state.explored.map((candidate) => ({
          objective: candidate.objective,
          evidence: candidate.evidenceRefs ?? [],
          origin: 'exploracion' as const,
        })),
      ];

  const current = currentWork(state);
  const currentKey = current ? normalize(current.objective) : null;
  const seen = new Set<string>();
  const pending: CycleWorkItem[] = [];

  for (const item of items) {
    const key = normalize(item.objective);
    if (!key || key === currentKey) continue;
    if (completed.has(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    pending.push(item);
  }

  return pending;
}

/** Como se dice quien conduce la mision, en una frase. */
export function driverLine(driver: Driver | null): string {
  if (driver === 'plugin') return 'el plugin (encadena desde la sesion)';
  if (driver === 'supervisor') return 'el supervisor (proceso externo)';
  return 'nadie todavia: los dos caminos estan esperando';
}

/**
 * Por que la cadena esta como esta, en una frase.
 *
 * Sin esto, "no hay trabajo" y "otro camino conduce" son la misma cosa, y el
 * agente no puede aplicar la regla de la skill —que dice que si el estado
 * nombra a quien conduce, no espere al siguiente objetivo—. Cada caso dice lo
 * suyo: la cadena aparcada, la cadena parada, un objetivo en curso, el camino
 * que tiene el mando, o que no hay trabajo elegible.
 */
export function whyNotChained(view: CycleView): string {
  if (view.status === 'paused_by_user') {
    return 'la cadena esta pausada por el usuario: no se encadena nada hasta que se reanude';
  }
  if (view.status === 'stopped_by_user') {
    return 'la cadena esta parada: no se encadena nada';
  }
  if (view.status === 'escalated') {
    return `la cadena necesita a alguien: no se encadena nada${view.reason ? ` (${view.reason})` : ''}`;
  }
  if (view.status === 'parked') {
    return `la cadena esta aparcada${view.reason ? `: ${view.reason}` : ': no hay trabajo util'}`;
  }
  if (view.current) {
    return `hay un objetivo en curso: ${view.current.objective}`;
  }
  if (view.driver === 'plugin') {
    return 'conduce el plugin: el siguiente objetivo se encadena al cerrar el turno';
  }
  if (view.driver === 'supervisor') {
    return 'conduce el supervisor: el siguiente objetivo se encadena en su siguiente sondeo';
  }
  if (view.pending.length === 0) {
    return 'no hay trabajo elegible: el backlog esta vacio y la exploracion no ha encontrado nada';
  }
  return 'nadie conduce todavia: el primer camino que actue tomara el mando';
}

/** Miles con punto, que es como se leen los numeros en este proyecto. */
function formatTokens(value: number): string {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Cuanto se enseña de cada lista, para que la vista no crezca sin fin. */
export interface CycleViewLimits {
  /** Objetivos hechos que se enseñan. Por defecto, todos. */
  maxDone?: number;
  /** Trabajos pendientes que se enseñan. Por defecto, todos. */
  maxPending?: number;
}

/**
 * Pinta la vista del ciclo.
 *
 * Cada linea dice una sola cosa, y el bloque esta ordenado como lo lee una
 * persona: primero que se quiere conseguir, luego donde esta la cadena, luego
 * que se esta haciendo ahora, y despues el historico y lo que queda.
 *
 * Los limites existen porque el texto viaja dentro del objetivo, y el objetivo
 * tiene un tope de longitud en el host: una vista que no cabe no se entrega.
 * Lo que se recorta se dice, para que lo que falta no parezca que no existe.
 */
export function renderCycleView(view: CycleView, limits: CycleViewLimits = {}): string {
  const maxDone = limits.maxDone ?? view.done.length;
  const maxPending = limits.maxPending ?? view.pending.length;

  const lines: string[] = [];

  lines.push(`Ciclo activo: ${view.missionId}`);
  lines.push(`- mision: ${view.objective}`);
  lines.push(`- estado: ${view.status}`);
  lines.push(`- conduce: ${driverLine(view.driver)}`);

  if (view.current) {
    const evidence = view.current.evidence.length > 0 ? view.current.evidence.join(', ') : 'sin evidencia';
    lines.push(`- objetivo en curso: ${view.current.objective} (evidencia: ${evidence})`);
  } else {
    lines.push('- objetivo en curso: ninguno');
  }

  const budget =
    view.tokenBudget === null
      ? `${formatTokens(view.tokensUsed)} token(s), sin limite declarado`
      : `${formatTokens(view.tokensUsed)} token(s) de ${formatTokens(view.tokenBudget)}`;
  lines.push(
    `- presupuesto: ${budget}` +
      (view.budgetExceeded ? ' (superado: la cadena sigue, el presupuesto es una medida)' : ''),
  );
  lines.push(`- objetivos encadenados: ${view.goalsCreated}`);

  if (view.budgetExhaustions > 0) {
    lines.push(`- intentos que se quedaron sin presupuesto: ${view.budgetExhaustions}`);
  }

  if (view.done.length === 0) {
    lines.push('Hechos: ninguno todavia.');
  } else {
    lines.push('Hechos:');
    const shown = maxDone >= view.done.length ? view.done : view.done.slice(-maxDone);
    for (const item of shown) {
      lines.push(
        `- ${item.objective} — ${item.status} (${formatTokens(item.tokensUsed)} token(s))`,
      );
    }
    const omitted = view.done.length - shown.length;
    if (omitted > 0) lines.push(`- ... y ${omitted} objetivo(s) mas, ya terminado(s)`);
  }

  if (view.pending.length === 0) {
    lines.push('Pendiente: nada declarado.');
  } else {
    lines.push('Pendiente:');
    const shown = maxPending >= view.pending.length ? view.pending : view.pending.slice(0, maxPending);
    for (const item of shown) {
      const evidence = item.evidence.length > 0 ? ` (evidencia: ${item.evidence.join(', ')})` : '';
      lines.push(`- ${item.objective}${evidence} [${item.origin}]`);
    }
    const omitted = view.pending.length - shown.length;
    if (omitted > 0) lines.push(`- ... y ${omitted} trabajo(s) mas en la cola`);
  }

  return lines.join('\n');
}
