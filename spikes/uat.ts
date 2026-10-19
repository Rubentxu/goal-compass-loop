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
import { runScenario, seedWorkspace, type Check, type Scenario, type ScenarioContext } from './harness.js';
import type { Candidate } from '../src/core/types.js';

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

/** El primer Goal termina y el supervisor crea el siguiente sin intervencion. */
const chain: Scenario = {
  name: 'chain',
  description: 'Varios Goals encadenados, sin intervencion del usuario entre ellos',
  async run(context: ScenarioContext): Promise<Check[]> {
    await context.setCandidates([
      candidate({ candidateId: 'primero' }),
      candidate({
        candidateId: 'segundo',
        objective: fileGoal('resultado-2.txt', 'SEGUNDO'),
        doneWhen: ['resultado-2.txt existe con el contenido exacto SEGUNDO'],
        priority: 8,
      }),
      candidate({
        candidateId: 'tercero',
        objective: fileGoal('resultado-3.txt', 'TERCERO'),
        doneWhen: ['resultado-3.txt existe con el contenido exacto TERCERO'],
        priority: 6,
      }),
    ]);
    context.startSupervisor();

    await context.waitFor('tres Goals terminados', async () => {
      const state = await context.readJournal();
      return state.goals.length >= 3;
    });

    const state = await context.readJournal();
    const created = state.intents.filter((intent) => intent.status === 'committed');
    const goalIds = new Set(created.map((intent) => intent.goalId));
    const objectives = new Set(created.map((intent) => intent.objective));
    const tokens = state.goals.reduce((total, record) => total + record.tokensUsed, 0);

    return [
      { name: 'se crearon tres Goals', ok: created.length === 3, detail: `${created.length}` },
      { name: 'los Goals tienen identificadores distintos', ok: goalIds.size === 3 },
      { name: 'los Goals tienen objetivos distintos', ok: objectives.size === 3 },
      { name: 'todos los Goals terminaron', ok: state.goals.length >= 3 },
      { name: 'el primer trabajo se produjo', ok: existsSync(join(context.workspace, 'resultado.txt')) },
      {
        name: 'el segundo trabajo se produjo',
        ok: existsSync(join(context.workspace, 'resultado-2.txt')),
      },
      {
        name: 'el tercer trabajo se produjo',
        ok: existsSync(join(context.workspace, 'resultado-3.txt')),
      },
      { name: 'no hay Goals duplicados', ok: created.length === 3 },
      { name: 'la mision no quedo escalada', ok: state.mission.status !== 'escalated' },
      {
        name: 'el coste de la cadena es conocido',
        ok: tokens > 0,
        detail: `${tokens} tokens en ${state.goals.length} Goals`,
      },
    ];
  },
};

/** Sin backlog ni senales en el codigo, la exploracion encuentra trabajo real. */
const exploration: Scenario = {
  name: 'exploration',
  description: 'Sin backlog ni pendientes marcados, la exploracion encuentra trabajo real y lo encadena',
  async run(context: ScenarioContext): Promise<Check[]> {
    // El trabajo pendiente solo aparece descrito en prosa: el escaner
    // determinista no lo ve, asi que solo la exploracion puede encontrarlo.
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

    await context.waitFor('un Goal creado desde la exploracion', async () => {
      const state = await context.readJournal();
      return state.intents.some((intent) => intent.status === 'committed');
    });

    const state = await context.readJournal();
    const created = state.intents.filter((intent) => intent.status === 'committed');
    const proposed = state.explored;

    return [
      { name: 'la exploracion aporto candidatos', ok: proposed.length > 0, detail: `${proposed.length}` },
      {
        name: 'la evidencia senala a un fichero real',
        ok: proposed.every((candidate) =>
          candidate.evidenceRefs.every((ref) => existsSync(join(context.workspace, ref.split(':')[0]!))),
        ),
      },
      { name: 'se creo un Goal a partir de la exploracion', ok: created.length >= 1 },
      { name: 'el Goal viene de la exploracion', ok: state.explored.length > 0 || created.length >= 1 },
    ];
  },
};

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
  for (const name of names) {
    const scenario = SCENARIOS[name];
    if (!scenario) {
      console.error(`escenario desconocido: ${name}`);
      failures.push(name);
      continue;
    }
    const result = await runScenario(scenario);
    if (!result.ok) failures.push(name);
  }

  console.log('\n=============== RESUMEN ===============');
  for (const name of names) {
    const failed = failures.includes(name);
    console.log(`${failed ? 'FALLA' : 'PASA'} · ${name}`);
  }
  console.log('=======================================');
  process.exit(failures.length > 0 ? 2 : 0);
}

main().catch((err) => {
  console.error('la ejecucion de escenarios fallo:', err);
  process.exit(1);
});
