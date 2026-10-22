/**
 * Harness compartido de pruebas.
 *
 * Un solo lugar define como se construye el mundo de una prueba: la mision, el
 * candidato, el Goal y el snapshot, mas dobles en memoria que respetan las
 * reglas del host real (un unico Goal por sesion, pausa y reanudacion).
 *
 * Las pruebas de unidad y los escenarios de aceptacion usan este mismo
 * harness, de modo que lo que se comprueba en memoria y lo que se comprueba
 * contra el host real no pueden divergir en su modelo.
 */
import type { ChainLockHandle } from '../../src/ports.js';
import type {
  Candidate,
  GoalState,
  Journal,
  Mission,
  MissionStatus,
  Snapshot,
} from '../../src/core/types.js';
import { emptyMetrics } from '../../src/core/types.js';
import type { GoalPort, JournalPort, GoalAdapter } from '../../src/ports.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempDir } from './temp.js';

const NOW = 1_700_000_000_000;

/** Candidato valido y minimo. */
export function aCandidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    candidateId: 'c1',
    objective: 'Corregir el fallo de parseo',
    whyNow: 'Se reprodujo en la integracion continua',
    evidenceRefs: ['docs/triage.md#parseo'],
    doneWhen: ['La prueba que fallaba pasa'],
    risk: 'low',
    priority: 10,
    prerequisites: [],
    source: 'observed',
    ...overrides,
  };
}

/** Una seccion del roadmap, tal y como las escribe un proyecto. */
export interface SeccionRoadmap {
  /** Ancla a la que se puede apuntar desde la evidencia de un trabajo. */
  ancla: string;
  titulo: string;
  /** Si la parte de trabajo que describe esta seccion sigue pendiente. */
  estado: 'abierto' | 'cerrado';
}

/**
 * Un workspace con un roadmap dentro.
 *
 * El roadmap es la forma en que un proyecto dice que una parte de su trabajo ya
 * esta hecha. El workspace de prueba lo dice con las mismas palabras que el de
 * verdad —una seccion, su ancla y su estado— para que la prueba no dependa de
 * como se busca una seccion, sino de lo que el proyecto dice.
 */
export function unWorkspaceConRoadmap(secciones?: SeccionRoadmap[]): string {
  const workspace = tempDir('gcl-workspace-');
  const lista = secciones ?? [
    { ancla: 'abierto', titulo: 'Trabajo que sigue', estado: 'abierto' as const },
    { ancla: 'cerrado', titulo: 'Trabajo ya hecho', estado: 'cerrado' as const },
  ];

  const texto = lista
    .map((seccion) =>
      [
        `<a id="${seccion.ancla}"></a>`,
        '',
        `## ${seccion.titulo}`,
        '',
        seccion.estado === 'cerrado'
          ? '**Estado:** cerrado (esta parte ya no hace falta)'
          : '**Estado:** pendiente',
        '',
      ].join('\n'),
    )
    .join('\n');

  mkdirSync(join(workspace, 'docs'), { recursive: true });
  writeFileSync(join(workspace, 'docs', 'roadmap.md'), texto);
  return workspace;
}

/**
 * Una declaracion de mision, con el nombre y la forma que usa el producto.
 *
 * Devuelve la ruta del fichero: es lo que leen la cadena y el diagnostico. Lo
 * que no se dice se deja a los valores por defecto del cargador, que son los
 * que usa el producto: el arnes no debe decidir por su cuenta como es una
 * declaracion.
 */
export function unaDeclaracion(
  workspace: string,
  options: {
    backlog?: Candidate[];
    missionId?: string;
    objective?: string;
    driver?: 'supervisor' | 'plugin';
  } = {},
): string {
  const path = join(workspace, 'goal-compass.json');
  writeFileSync(
    path,
    JSON.stringify(
      {
        missionId: options.missionId ?? 'm1',
        objective: options.objective ?? 'Mejorar el proyecto',
        workspace,
        allowRemoteWrite: false,
        ...(options.driver !== undefined ? { driver: options.driver } : {}),
        backlog: options.backlog ?? [],
      },
      null,
      2,
    ),
  );
  return path;
}

/**
 * Un objetivo que consiste en escribir un fichero.
 *
 * Es el trabajo mas pequeno que se puede comprobar contra el host real: no le
 * pide al modelo que piense nada, y al final el fichero esta o no esta.
 */
export function unObjetivoDeFichero(name: string, contenido: string): string {
  return (
    `Escribe un fichero llamado ${name} en el directorio de trabajo actual con el texto exacto ${contenido} ` +
    'y termina el objetivo cuando el fichero exista con ese contenido.'
  );
}

/** Un candidato cuyo trabajo es escribir un fichero. */
export function unCandidatoDeFichero(overrides: Partial<Candidate> = {}): Candidate {
  return {
    candidateId: 'trabajo-1',
    objective: unObjetivoDeFichero('resultado.txt', 'RESULTADO'),
    whyNow: 'trabajo pendiente de la cadena',
    evidenceRefs: ['escenario/resultado.txt'],
    doneWhen: ['resultado.txt existe con el contenido exacto RESULTADO'],
    scope: 'escenario',
    risk: 'low',
    priority: 10,
    prerequisites: [],
    source: 'observed',
    ...overrides,
  };
}

/** Goal con la forma que devuelve el host. */
export function aGoal(overrides: Partial<GoalState> = {}): GoalState {
  return {
    goalId: 'tg_1',
    sessionId: 's1',
    objective: 'objetivo anterior',
    status: 'complete',
    createdAt: NOW - 1_000,
    updatedAt: NOW,
    tokensUsed: 100,
    turnsUsed: 1,
    timeUsedSeconds: 10,
    statusReason: 'complete(verifier_met)',
    executionWait: null,
    hasKickoffAttachments: false,
    ...overrides,
  };
}

/** Mision por defecto, en marcha y sin limites. */
export function aMission(overrides: Partial<Mission> = {}): Mission {
  return {
    missionId: 'm1',
    objective: 'Mejorar el proyecto',
    status: 'running',
    defaultTokenBudget: 100_000,
    totalTokenBudget: null,
    maxGoals: null,
    stallTimeoutMs: 45 * 60_000,
    explorationEnabled: true,
    explorationCooldownMs: 30 * 60_000,
    workspace: '/tmp/workspace',
    backlog: [],
    allowRemoteWrite: false,
    ...overrides,
  };
}

/** Snapshot por defecto: sin Goal, sin candidatos, sin trabajo hecho. */
export function aSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    mission: aMission(),
    goal: null,
    candidates: [],
    pendingIntent: null,
    completedGoalIds: [],
    completedCandidateIds: [],
    completedCandidateKeys: [],
    goalsCreated: 0,
    tokensUsedTotal: 0,
    ownGoal: false,
    goalCandidate: null,
    goalCandidateKey: null,
    budgetAttempts: [],
    goalProgressSince: null,
    now: NOW,
    ...overrides,
  };
}

/** Journal vacio listo para usar. */
export function anEmptyJournal(mission: Mission = aMission()): Journal {
  return {
    version: 1,
    missionId: mission.missionId,
    sessionId: 's1',
    mission,
    goals: [],
    intents: [],
    progress: undefined,
    explored: [],
    explorationStreak: 0,
    lastExplorationAt: undefined,
    budgetAttempts: [],
    metrics: emptyMetrics(),
    updatedAt: new Date(NOW).toISOString(),
  };
}

/**
 * Host de Goals en memoria con las mismas reglas que el real:
 * una unica sesion, un unico Goal, y la creacion sustituye al anterior.
 */
export class MemoryGoalHost implements GoalPort {
  current: GoalState | null = null;
  createCount = 0;
  pauseCount = 0;
  resumeCount = 0;
  clearCount = 0;
  /** Presupuestos con los que se han creado los objetivos, en orden. */
  grantedBudgets: number[] = [];
  private counter = 0;

  async read(): Promise<GoalState | null> {
    return this.current;
  }

  async create(
    _sessionId: string,
    objective: string,
    tokenBudget: number | undefined,
  ): Promise<GoalState> {
    this.createCount += 1;
    this.counter += 1;
    this.grantedBudgets.push(tokenBudget ?? 0);
    this.current = aGoal({
      goalId: `tg_new_${this.counter}`,
      objective,
      status: 'active',
      createdAt: NOW,
      updatedAt: NOW,
      tokensUsed: 0,
      turnsUsed: 0,
      ...(tokenBudget !== undefined ? { tokenBudget } : {}),
      statusReason: null,
    });
    return this.current;
  }

  async pause(): Promise<GoalState | null> {
    this.pauseCount += 1;
    if (this.current) this.current = { ...this.current, status: 'paused' };
    return this.current;
  }

  async resume(): Promise<GoalState | null> {
    this.resumeCount += 1;
    if (this.current) this.current = { ...this.current, status: 'active' };
    return this.current;
  }

  /**
   * Libera el objetivo de la sesion.
   *
   * El host real guarda un unico objetivo por sesion: mientras haya uno, no
   * deja crear el siguiente.
   */
  async clear(): Promise<boolean> {
    this.clearCount += 1;
    const had = this.current !== null;
    this.current = null;
    return had;
  }

  sessionId(): string {
    return 's1';
  }

  async close(): Promise<void> {}

  /** Marca el Goal actual como terminado, como hace el runtime. */
  complete(tokensUsed = 1_000): GoalState {
    const completed = aGoal({
      ...(this.current ?? {}),
      status: 'complete',
      statusReason: 'complete(verifier_met)',
      tokensUsed,
      updatedAt: NOW,
    });
    this.current = completed;
    return completed;
  }

  /** Deja el objetivo actual sin presupuesto, como hace el host al agotarlo. */
  exhaust(tokensUsed: number): GoalState {
    const exhausted = aGoal({
      ...(this.current ?? {}),
      status: 'budget_limited',
      statusReason: 'budget_limited(token_budget_exhausted)',
      tokensUsed,
      updatedAt: NOW,
    });
    this.current = exhausted;
    return exhausted;
  }
}

/**
 * El host de Goals en memoria, apto tambien para arrancar una mision.
 *
 * El runtime abre un host de verdad cuando no se le da otro, y eso cuesta
 * segundos: para comprobar como se guarda el estado no hace falta un host
 * real, hace falta uno que obedezca las mismas reglas.
 */
export class MemoryGoalAdapter extends MemoryGoalHost implements GoalAdapter {
  async start(): Promise<void> {}

  async ask(question: string): Promise<string> {
    return '';
  }
}

/** Journal en memoria con escritura atomica simulada. */
export class MemoryJournal implements JournalPort {
  state: Journal;

  constructor(state: Journal = anEmptyJournal()) {
    this.state = state;
  }

  async load(): Promise<Journal> {
    return this.state;
  }

  async saveAtomically(journal: Journal): Promise<void> {
    this.state = journal;
  }
}

/** Canal de control en memoria, escribible desde la propia prueba. */
export class MemoryControl {
  status: MissionStatus | null = null;

  async read(): Promise<MissionStatus | null> {
    return this.status;
  }
}

/**
 * Un candado de mentira que lo tiene todo el mundo: suelta, dice que es suyo y
 * se renueva. Es lo que necesitan las pruebas que no van de propiedad.
 */
export function unCandado(): ChainLockHandle {
  const candado = (() => {}) as ChainLockHandle;
  candado.valid = () => true;
  candado.renew = () => {};
  return candado;
}
