/**
 * La vista del ciclo activo.
 *
 * Se comprueba que la vista dice lo que tiene que decir —que quiere la
 * mision, que objetivo va, que esta hecho, que queda y cuanto ha gastado— y
 * que no miente: no ofrece como pendiente lo que ya se pago ni lo que esta
 * en curso.
 */
import { describe, expect, it } from 'vitest';
import { cycleViewOf, renderCycleView } from '../src/core/cycle-view.js';
import { freshJournal, type Journal, type Mission } from '../src/core/types.js';

function mission(overrides: Partial<Mission> = {}): Mission {
  return {
    missionId: 'prueba-ciclo',
    objective: 'Dejar el producto en pie',
    status: 'running',
    defaultTokenBudget: 60000,
    totalTokenBudget: 200000,
    maxGoals: null,
    stallTimeoutMs: 600000,
    explorationEnabled: true,
    explorationCooldownMs: 300000,
    workspace: '/tmp/prueba-ciclo',
    backlog: [],
    allowRemoteWrite: false,
    ...overrides,
  };
}

function journal(overrides: Partial<Journal> = {}): Journal {
  return { ...freshJournal(mission()), ...overrides };
}

describe('la vista del ciclo', () => {
  it('dice que quiere la mision, en que esta y quien la conduce', () => {
    const state = journal({ mission: mission({ driver: 'plugin' }) });

    const texto = renderCycleView(cycleViewOf(state));

    expect(texto).toContain('Ciclo activo: prueba-ciclo');
    expect(texto).toContain('mision: Dejar el producto en pie');
    expect(texto).toContain('estado: running');
    expect(texto).toContain('conduce: el plugin');
  });

  it('dice que nadie conduce la mision cuando todavia no se ha tomado el mando', () => {
    const texto = renderCycleView(cycleViewOf(journal()));

    expect(texto).toContain('conduce: nadie todavia');
  });

  it('enseña el objetivo en curso con la evidencia que lo respalda', () => {
    const state = journal({
      intents: [
        {
          intentId: 'i-1',
          candidateId: 'c-1',
          candidateKey: 'c-1',
          objective: 'Arreglar el escaner',
          hostObjective: 'Arreglar el escaner',
          evidenceRefs: ['src/adapters/discovery.ts'],
          doneWhen: ['el escaner ve la deuda'],
          tokenBudget: 60000,
          createdAt: '2026-01-01T00:00:00.000Z',
          status: 'committed',
          goalId: 'g-1',
        },
      ],
      progress: { goalId: 'g-1', signature: 'active|3|900', since: 1000 },
    });

    const texto = renderCycleView(cycleViewOf(state));

    expect(texto).toContain('objetivo en curso: Arreglar el escaner');
    expect(texto).toContain('evidencia: src/adapters/discovery.ts');
  });

  it('enseña la intencion a medio confirmar cuando todavia no hay objetivo vivo', () => {
    const state = journal({
      intents: [
        {
          intentId: 'i-1',
          candidateId: 'c-1',
          candidateKey: 'c-1',
          objective: 'Empezar por lo primero',
          hostObjective: 'Empezar por lo primero',
          evidenceRefs: ['README.md'],
          doneWhen: ['esta hecho'],
          tokenBudget: 60000,
          createdAt: '2026-01-01T00:00:00.000Z',
          status: 'intent',
        },
      ],
    });

    const texto = renderCycleView(cycleViewOf(state));

    expect(texto).toContain('objetivo en curso: Empezar por lo primero');
  });

  it('dice que no hay objetivo en curso cuando no lo hay', () => {
    const texto = renderCycleView(cycleViewOf(journal()));

    expect(texto).toContain('objetivo en curso: ninguno');
  });

  it('enseña los objetivos hechos con el estado con el que terminaron', () => {
    const state = journal({
      goals: [
        {
          goalId: 'g-1',
          objective: 'Cerrar P0',
          status: 'complete',
          statusReason: null,
          tokensUsed: 1200,
          turnsUsed: 3,
          startedAt: 1,
          endedAt: 2,
          candidateId: 'c-1',
          candidateKey: 'c-1',
          receipt: 'ok',
        },
        {
          goalId: 'g-2',
          objective: 'Quitar la deuda',
          status: 'blocked',
          statusReason: 'falta una decision',
          tokensUsed: 300,
          turnsUsed: 1,
          startedAt: 3,
          endedAt: 4,
          candidateId: 'c-2',
          candidateKey: 'c-2',
          receipt: 'ok',
        },
      ],
    });

    const texto = renderCycleView(cycleViewOf(state));

    expect(texto).toContain('Cerrar P0 — complete (1.200 token(s))');
    expect(texto).toContain('Quitar la deuda — blocked');
  });

  it('no ofrece como pendiente lo que ya se pago', () => {
    const state = journal({
      mission: mission({
        backlog: [
          {
            candidateId: 'c-1',
            objective: 'Trabajo ya pagado',
            whyNow: 'porque si',
            evidenceRefs: ['README.md'],
            doneWhen: ['hecho'],
            risk: 'low',
            priority: 1,
            prerequisites: [],
            source: 'roadmap',
          },
        ],
      }),
    });

    const texto = renderCycleView(cycleViewOf(state, { completed: new Set(['trabajo ya pagado']) }));

    expect(texto).toContain('Pendiente: nada declarado.');
  });

  it('no ofrece como pendiente el trabajo que esta en curso', () => {
    const state = journal({
      mission: mission({
        backlog: [
          {
            candidateId: 'c-1',
            objective: 'Trabajo en curso',
            whyNow: 'porque si',
            evidenceRefs: ['README.md'],
            doneWhen: ['hecho'],
            risk: 'low',
            priority: 1,
            prerequisites: [],
            source: 'roadmap',
          },
        ],
      }),
      intents: [
        {
          intentId: 'i-1',
          candidateId: 'c-1',
          candidateKey: 'c-1',
          objective: 'Trabajo en curso',
          hostObjective: 'Trabajo en curso',
          evidenceRefs: ['README.md'],
          doneWhen: ['hecho'],
          tokenBudget: 60000,
          createdAt: '2026-01-01T00:00:00.000Z',
          status: 'committed',
          goalId: 'g-1',
        },
      ],
      progress: { goalId: 'g-1', signature: 'active|1|10', since: 1 },
    });

    const texto = renderCycleView(cycleViewOf(state));

    expect(texto).toContain('objetivo en curso: Trabajo en curso');
    expect(texto).toContain('Pendiente: nada declarado.');
  });

  it('enseña el trabajo pendiente con su evidencia y de donde sale', () => {
    const view = cycleViewOf(journal(), {
      pending: [
        { objective: 'Arreglar el reloj', evidence: ['src/core/nudge.ts'], origin: 'backlog' },
        { objective: 'Medir el empujon', evidence: [], origin: 'propuesta' },
      ],
    });

    const texto = renderCycleView(view);

    expect(texto).toContain('Pendiente:');
    expect(texto).toContain('Arreglar el reloj (evidencia: src/core/nudge.ts) [backlog]');
    expect(texto).toContain('Medir el empujon [propuesta]');
  });

  it('enseña cuanto se ha gastado y de cuanto habia', () => {
    const state = journal({
      metrics: {
        tokensUsed: 45000,
        budgetExceeded: true,
        budgetExhaustions: 1,
        goalsCreated: 4,
      },
    });

    const texto = renderCycleView(cycleViewOf(state));

    expect(texto).toContain('presupuesto: 45.000 token(s) de 200.000');
    expect(texto).toContain('superado');
    expect(texto).toContain('intentos que se quedaron sin presupuesto: 1');
    expect(texto).toContain('objetivos encadenados: 4');
  });

  it('acota las listas y dice cuanto dejo fuera', () => {
    const view = cycleViewOf(journal(), {
      pending: [
        { objective: 'Uno', evidence: [], origin: 'backlog' },
        { objective: 'Dos', evidence: [], origin: 'backlog' },
        { objective: 'Tres', evidence: [], origin: 'backlog' },
      ],
    });

    const texto = renderCycleView(view, { maxDone: 0, maxPending: 2 });

    expect(texto).toContain('- Uno');
    expect(texto).toContain('- Dos');
    expect(texto).not.toContain('- Tres');
    expect(texto).toContain('y 1 trabajo(s) mas en la cola');
  });
});
