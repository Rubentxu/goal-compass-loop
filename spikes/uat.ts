/**
 * Escenarios de aceptacion contra el host real.
 *
 *   npm run uat            ejecuta todos
 *   npm run uat -- chain   ejecuta uno
 *
 * Cada escenario comprueba una capacidad concreta del supervisor y deja un
 * recibo con el resultado de cada comprobacion.
 */
import { existsSync } from 'node:fs';
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
  description: 'Un Goal terminado da paso a otro Goal nativo sin intervencion del usuario',
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
    context.startSupervisor();

    await context.waitFor('dos Goals terminados', async () => {
      const state = await context.readJournal();
      return state.goals.length >= 2;
    });

    const state = await context.readJournal();
    const created = state.intents.filter((intent) => intent.status === 'committed');
    const goalIds = new Set(created.map((intent) => intent.goalId));
    const objectives = new Set(created.map((intent) => intent.objective));

    return [
      { name: 'se crearon dos Goals', ok: created.length === 2, detail: `${created.length}` },
      { name: 'los Goals tienen identificadores distintos', ok: goalIds.size === 2 },
      { name: 'los Goals tienen objetivos distintos', ok: objectives.size === 2 },
      { name: 'el primer Goal termino', ok: state.goals.length >= 1 },
      { name: 'el segundo Goal termino', ok: state.goals.length >= 2 },
      { name: 'el primer trabajo se produjo', ok: existsSync(join(context.workspace, 'resultado.txt')) },
      {
        name: 'el segundo trabajo se produjo',
        ok: existsSync(join(context.workspace, 'resultado-2.txt')),
      },
      { name: 'la mision no quedo escalada', ok: state.mission.status !== 'escalated' },
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
    context.startSupervisor();

    await context.waitFor('el primer Goal terminado', async () => {
      const state = await context.readJournal();
      return state.goals.length >= 1;
    });

    // El presupuesto se fija por debajo de lo ya gastado: la cadena debe detenerse.
    await context.patchMission({ totalTokenBudget: 1 });

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

const SCENARIOS: Record<string, Scenario> = { chain, recovery, pause, budget };

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
