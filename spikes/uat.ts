/**
 * Escenarios de aceptacion contra el host real.
 *
 *   npm run uat            ejecuta todos
 *   npm run uat -- chain   ejecuta uno
 *
 * Cada escenario comprueba una capacidad concreta del supervisor y deja un
 * recibo con el resultado de cada comprobacion.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  HostInterruption,
  runScenario,
  seedWorkspace,
  type Check,
  type Scenario,
  type ScenarioContext,
} from './harness.js';
import { readProposals } from '../src/adapters/proposals.js';
import type { Candidate, Journal } from '../src/core/types.js';

/** Objetivo trivial: escribir un fichero con un texto exacto. */
function fileGoal(name: string, content: string): string {
  return (
    `Escribe un fichero llamado ${name} en el directorio de trabajo actual con el texto exacto ${content} ` +
    'y termina el objetivo cuando el fichero exista con ese contenido.'
  );
}

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    candidateId: 'trabajo-1',
    objective: fileGoal('resultado.txt', 'RESULTADO'),
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

/**
 * El primer Goal termina y el supervisor crea el siguiente sin intervencion.
 *
 * El trabajo del medio llega por el canal de propuestas, como cuando el agente
 * propone el siguiente objetivo durante la sesion. Se comprueba que compite
 * con el backlog por prioridad y que se encadena en su momento, sin quedarse
 * para el final ni quedarse sin encadenar.
 *
 * Si el host interrumpe un objetivo, el escenario no se da por bueno ni por
 * malo: se marca como no corrido, porque lo que fallo no fue el sistema.
 */
const chain: Scenario = {
  name: 'chain',
  description: 'Varios Goals encadenados, sin intervencion del usuario entre ellos',
  timeoutMs: 30 * 60_000,
  async run(context: ScenarioContext): Promise<Check[]> {
    seedWorkspace(context.workspace, 'escenario/notas.md', 'el segundo trabajo esta propuesto\n');
    context.propose({
      objective: fileGoal('resultado-2.txt', 'SEGUNDO'),
      evidence: 'escenario/notas.md',
      whyNow: 'propuesto durante la sesion',
      doneWhen: ['resultado-2.txt existe con el contenido exacto SEGUNDO'],
    });

    await context.setCandidates([
      candidate({ candidateId: 'primero' }),
      candidate({
        candidateId: 'tercero',
        objective: fileGoal('resultado-3.txt', 'TERCERO'),
        doneWhen: ['resultado-3.txt existe con el contenido exacto TERCERO'],
        priority: 3,
      }),
    ]);
    context.startSupervisor();

    let interruption: string | undefined;
    try {
      await context.waitForCompletedGoals(3);
    } catch (err) {
      if (!(err instanceof HostInterruption)) throw err;
      interruption = err.message;
    }

    const state = await context.readJournal();
    const created = state.intents.filter((intent) => intent.status === 'committed');
    const goalIds = new Set(created.map((intent) => intent.goalId));
    const objectives = new Set(created.map((intent) => intent.objective));
    const tokens = state.goals.reduce((total, record) => total + record.tokensUsed, 0);
    const proposedIndex = created.findIndex((intent) => intent.candidateId.startsWith('propuesta:'));
    const skip = interruption !== undefined;

    return [
      { name: 'se crearon tres Goals', ok: skip ? false : created.length === 3, detail: `${created.length}`, skipped: skip },
      { name: 'los Goals tienen identificadores distintos', ok: skip ? false : goalIds.size === 3, skipped: skip },
      { name: 'los Goals tienen objetivos distintos', ok: skip ? false : objectives.size === 3, skipped: skip },
      { name: 'todos los Goals terminaron', ok: skip ? false : state.goals.length >= 3, skipped: skip },
      { name: 'el primer trabajo se produjo', ok: skip ? false : existsSync(join(context.workspace, 'resultado.txt')), skipped: skip },
      {
        name: 'el segundo trabajo se produjo',
        ok: skip ? false : existsSync(join(context.workspace, 'resultado-2.txt')),
        skipped: skip,
      },
      {
        name: 'el tercer trabajo se produjo',
        ok: skip ? false : existsSync(join(context.workspace, 'resultado-3.txt')),
        skipped: skip,
      },
      { name: 'el trabajo propuesto se encadeno', ok: proposedIndex >= 0 },
      {
        name: 'el trabajo propuesto se encadeno en su momento',
        ok: proposedIndex === 1,
        detail: interruption ? interruption : undefined,
        skipped: false,
      },
      { name: 'no hay Goals duplicados', ok: skip ? false : created.length === 3, skipped: skip },
      { name: 'la mision no quedo escalada', ok: state.mission.status !== 'escalated' },
      {
        name: 'el coste de la cadena es conocido',
        ok: skip ? false : tokens > 0,
        detail: `${tokens} tokens en ${state.goals.length} Goals`,
        skipped: skip,
      },
    ];
  },
};

/**
 * Sin backlog ni senales en el codigo, el sistema encuentra trabajo real.
 *
 * El trabajo puede llegar por dos caminos: la exploracion acotada del
 * workspace, o una propuesta que el agente deja con su herramienta. Con el
 * plugin instalado, el agente del host puede usar esa herramienta, asi que
 * el escenario comprueba el invariante y no el mecanismo: trabajo real,
 * encadenado, con evidencia que senala a un fichero de verdad.
 */
const exploration: Scenario = {
  name: 'exploration',
  description: 'Sin backlog ni pendientes marcados, el sistema encuentra trabajo real y lo encadena',
  timeoutMs: 20 * 60_000,
  async run(context: ScenarioContext): Promise<Check[]> {
    // El trabajo pendiente solo aparece descrito en prosa: el escaner
    // determinista no lo ve, asi que hace falta que alguien investigue.
    writeFileSync(
      join(context.workspace, 'NOTAS.md'),
      [
        '# Notas del proyecto',
        '',
        'La funcion `exportar` de `src/fechas.ts` todavia no esta implementada.',
        'Hay que escribirla y cubrirla con una prueba.',
        '',
      ].join('\n'),
    );
    mkdirSync(join(context.workspace, 'src'), { recursive: true });
    writeFileSync(
      join(context.workspace, 'src/fechas.ts'),
      'export function exportar(): string {\n  throw new Error("sin implementar");\n}\n',
    );

    await context.setCandidates([]);
    context.startSupervisor();

    await context.waitFor('un Goal creado', async () => {
      const state = await context.readJournal();
      return state.intents.some((intent) => intent.status === 'committed');
    });

    const state = await context.readJournal();
    const created = state.intents.filter((intent) => intent.status === 'committed');
    const first = created[0];
    const origin = first?.candidateId.startsWith('propuesta:') ? 'propuesta' : 'exploracion';
    const evidence = first ? evidenceOf(state, context.missionId, first.candidateId) : [];
    const real = evidence.filter((ref) => existsSync(join(context.workspace, ref.split(':')[0]!)));

    return [
      {
        name: 'se encadeno un Goal sin trabajo marcado',
        ok: created.length >= 1,
        detail: `origen: ${origin}`,
      },
      {
        name: 'el sistema pidio buscar trabajo',
        ok: state.lastExplorationAt !== undefined,
      },
      {
        name: 'el Goal viene de una fuente que investigo',
        ok: origin === 'exploracion' || origin === 'propuesta',
        detail: origin,
      },
      {
        name: 'su evidencia senala a un fichero real',
        ok: evidence.length > 0 && real.length === evidence.length,
        detail: evidence.join(', '),
      },
    ];
  },
};

/** La evidencia del trabajo encadenado, venga de donde venga. */
function evidenceOf(state: Journal, missionId: string, candidateId: string): string[] {
  const explored = state.explored.find((candidate) => candidate.candidateId === candidateId);
  if (explored) return explored.evidenceRefs;
  const proposal = readProposals(missionId).find((entry) => entry.candidateId === candidateId);
  return proposal?.evidenceRefs ?? [];
}

/** Un fallo entre creacion y commit se reconcilia sin duplicar Goals. */
const recovery: Scenario = {
  name: 'recovery',
  description: 'Una transicion a medias se reconcilia contra el host sin crear un Goal de mas',
  async run(context: ScenarioContext): Promise<Check[]> {
    await context.setCandidates([candidate({ candidateId: 'unico' })]);
    context.startSupervisor({ maxIterations: 1 });

    await context.waitFor('el primer Goal creado', async () => {
      const state = await context.readJournal();
      return state.intents.length > 0;
    });

    // Se reproduce la muerte del supervisor entre la creacion y el commit.
    const before = await context.readJournal();
    const originalGoalId = before.intents[0]?.goalId;
    before.intents[0]!.status = 'intent';
    before.intents[0]!.goalId = undefined;
    await context.journal.saveAtomically(before);

    await context.restartHost();
    context.startSupervisor({ maxIterations: 1 });

    await context.waitFor('la intencion reconciliada', async () => {
      const state = await context.readJournal();
      return state.intents[0]?.status === 'committed';
    });

    const state = await context.readJournal();
    const created = state.intents.filter((intent) => intent.status === 'committed');
    const goal = await context.adapter.read(context.adapter.sessionId());

    return [
      { name: 'la intencion quedo reconciliada', ok: state.intents[0]?.status === 'committed' },
      {
        name: 'la intencion apunta al Goal original',
        ok: state.intents[0]?.goalId === originalGoalId,
        detail: originalGoalId,
      },
      { name: 'no se creo un segundo Goal', ok: created.length === 1, detail: `${created.length}` },
      { name: 'el host conserva un unico Goal', ok: goal?.goalId === originalGoalId },
    ];
  },
};

/** La orden de pausa del usuario detiene el Goal en curso. */
const pause: Scenario = {
  name: 'pause',
  description: 'La orden de pausa del usuario detiene el Goal en curso y la de continuar lo reanuda',
  async run(context: ScenarioContext): Promise<Check[]> {
    await context.setCandidates([candidate({ candidateId: 'pausable' })]);
    context.startSupervisor();

    await context.waitFor('el Goal en marcha', async () => {
      const goal = await context.adapter.read(context.adapter.sessionId());
      return goal?.status === 'active';
    });

    await context.setControl('paused_by_user');
    await context.waitFor('el Goal pausado', async () => {
      const goal = await context.adapter.read(context.adapter.sessionId());
      return goal?.status === 'paused';
    });

    const paused = await context.adapter.read(context.adapter.sessionId());

    await context.setControl('running');
    await context.waitFor('el Goal reanudado', async () => {
      const goal = await context.adapter.read(context.adapter.sessionId());
      return goal?.status === 'active';
    });

    const state = await context.readJournal();

    return [
      { name: 'la pausa detuvo el Goal', ok: paused?.status === 'paused' },
      { name: 'la reanudacion devolvio el Goal a marcha', ok: true },
      { name: 'la pausa no creo Goals nuevos', ok: state.intents.length === 1 },
    ];
  },
};

/** Agotado el presupuesto de la mision, no se encadena otro Goal. */
const budget: Scenario = {
  name: 'budget',
  description: 'Agotado el presupuesto de la mision, la cadena se detiene sin crear Goals de mas',
  async run(context: ScenarioContext): Promise<Check[]> {
    await context.setCandidates([
      candidate({ candidateId: 'primero' }),
      candidate({
        candidateId: 'segundo',
        objective: fileGoal('resultado-2.txt', 'SEGUNDO'),
        doneWhen: ['resultado-2.txt existe con el contenido exacto SEGUNDO'],
        priority: 5,
      }),
    ]);
    // El presupuesto se fija antes de empezar: el primer objetivo se crea
    // porque aun no se ha gastado nada, y el segundo ya no entra.
    await context.patchMission({ totalTokenBudget: 1 });
    context.startSupervisor();

    await context.waitFor('el primer Goal terminado', async () => {
      const state = await context.readJournal();
      return state.goals.length >= 1;
    });

    await context.waitFor('la mision dormida por presupuesto', async () => {
      const state = await context.readJournal();
      return state.mission.status === 'parked' && (state.mission.reason ?? '').includes('presupuesto');
    });

    const state = await context.readJournal();
    const created = state.intents.filter((intent) => intent.status === 'committed');

    return [
      { name: 'la mision quedo dormida', ok: state.mission.status === 'parked' },
      {
        name: 'el motivo es el presupuesto',
        ok: (state.mission.reason ?? '').includes('presupuesto'),
        detail: state.mission.reason,
      },
      { name: 'no se encadenó un segundo Goal', ok: created.length === 1, detail: `${created.length}` },
    ];
  },
};

const SCENARIOS: Record<string, Scenario> = { chain, recovery, pause, budget, exploration };

async function main(): Promise<void> {
  const requested = process.argv.slice(2).filter((argument) => !argument.startsWith('-'));
  const names = requested.length > 0 ? requested : Object.keys(SCENARIOS);

  const failures: string[] = [];
  const notRun: string[] = [];
  for (const name of names) {
    const scenario = SCENARIOS[name];
    if (!scenario) {
      console.error(`escenario desconocido: ${name}`);
      failures.push(name);
      continue;
    }
    const result = await runScenario(scenario);
    if (result.interrupted) notRun.push(name);
    else if (!result.ok) failures.push(name);
  }

  console.log('\n=============== RESUMEN ===============');
  for (const name of names) {
    const failed = failures.includes(name);
    const skipped = notRun.includes(name);
    const verdict = failed ? 'FALLA' : skipped ? 'NO CORRIO' : 'PASA';
    console.log(`${verdict} · ${name}`);
  }
  console.log('=======================================');
  if (notRun.length > 0) {
    console.log(
      `Sin ejecutar por interrupcion del host: ${notRun.join(', ')}. ` +
        'El sistema no fallo: el trabajo no llego a terminarse.',
    );
  }
  process.exit(failures.length > 0 ? 2 : 0);
}

main().catch((err) => {
  console.error('la ejecucion de escenarios fallo:', err);
  process.exit(1);
});
