/**
 * El estado de la mision tiene que decir quien conduce y por que no se encadeno
 * nada.
 *
 * Sin esas dos lineas, el agente no puede distinguir "no hay trabajo" de "otro
 * camino conduce", que es justo la regla que la skill le pide aplicar antes de
 * esperar al siguiente objetivo.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { cleanupTempDirs, tempDir } from './support/temp.js';
import { buildMissionTools } from '../src/plugin/mcp-server.js';
import { whyNotChained, type CycleView } from '../src/core/cycle-view.js';
import type { Logger } from '../src/ports.js';

afterEach(cleanupTempDirs);

const quietLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };

/** Una vista minima, para probar el texto sin montar una mision entera. */
function vista(over: Partial<CycleView> = {}): CycleView {
  return {
    missionId: 'prueba',
    objective: 'un objetivo',
    status: 'running',
    driver: null,
    reason: null,
    current: null,
    done: [],
    pending: [],
    tokensUsed: 0,
    budgetExceeded: false,
    tokenBudget: null,
    goalsCreated: 0,
    budgetExhaustions: 0,
    ...over,
  };
}

describe('el estado de la mision dice quien conduce y por que no se encadeno', () => {
  it('la herramienta nombra el camino que conduce la mision', async () => {
    const workspace = tempDir('gcl-estado-conduce-');
    const tools = buildMissionTools({ cwd: workspace, logger: quietLogger });

    await tools.find((t) => t.name === 'mission_declare')?.run({
      objective: 'Mejorar el proyecto paso a paso',
    });
    const texto = await tools.find((t) => t.name === 'mission_status')?.run({});

    expect(texto).toContain('Conduce: nadie todavia');
    expect(texto).toContain('Cadena:');
  });

  it('una cadena aparcada dice por que esta aparcada', () => {
    const texto = whyNotChained(vista({ status: 'parked', reason: 'no hay trabajo util' }));

    expect(texto).toContain('aparcada');
    expect(texto).toContain('no hay trabajo util');
  });

  it('sin trabajo y sin conductor, el motivo es que no hay trabajo', () => {
    const texto = whyNotChained(vista());

    expect(texto).toContain('no hay trabajo elegible');
  });

  it('con un objetivo en curso, el motivo es ese objetivo', () => {
    const texto = whyNotChained(
      vista({
        current: {
          goalId: 'tg_1',
          objective: 'Escribir la prueba que falta',
          evidence: [],
        },
      }),
    );

    expect(texto).toContain('Escribir la prueba que falta');
  });

  it('cada camino que tiene el mando dice como se encadena lo siguiente', () => {
    expect(whyNotChained(vista({ driver: 'plugin' }))).toContain('plugin');
    expect(whyNotChained(vista({ driver: 'supervisor' }))).toContain('supervisor');
  });
});
