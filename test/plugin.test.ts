/**
 * Plugin de MCode: el hook de continuacion y el ensamblado del paquete.
 *
 * El hook se prueba contra el host ACP de mentira, que es un proceso real:
 * lo que se comprueba es que el objetivo se crea en la sesion del evento y
 * que el turno continua, sin tocar el host real.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

afterEach(cleanupTempDirs);
import { cleanupTempDirs, tempDir } from './support/temp.js';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';


import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHookEvent, runAutoContinue } from '../src/plugin/auto-continue.js';
import { findMissionFile, findMissionFileUpwards } from '../src/plugin/mission-locator.js';
import { installPlugin, PLUGIN_NAME } from '../src/plugin/install.js';
import type { Journal } from '../src/core/types.js';
import type { Logger } from '../src/ports.js';

const HOST_SCRIPT = fileURLToPath(new URL('./support/fake-acp-host.mjs', import.meta.url));
const HOST = { command: process.execPath, args: [HOST_SCRIPT] };

const quietLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };

/**
 * Ejecuta el hook como el host lo hace: un proceso aparte que lee un evento
 * por la entrada estandar y contesta por la salida estandar.
 *
 * Es la unica forma de comprobar lo que de verdad importa del hook: que
 * termina. Un hook que no termina hace que el host espere a su propio limite
 * y tire la continuacion preparada.
 */
function runHookProcess(
  workspace: string,
  binDir: string,
  env: Record<string, string>,
): Promise<{ code: number | null; elapsed: number; out: string }> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(
      join(process.cwd(), 'node_modules', '.bin', 'tsx'),
      ['src/plugin/auto-continue.ts'],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH ?? ''}`,
          ...env,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );

    let out = '';
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString();
    });
    child.stderr.on('data', () => {});

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('el hook no termino'));
    }, 30_000);

    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, elapsed: Date.now() - started, out });
    });

    child.stdin.write(
      `${JSON.stringify({ hook_event_name: 'Stop', session_id: 'mvs_fake', cwd: workspace })}\n`,
    );
    child.stdin.end();
  });
}


function writeMission(workspace: string, allowRemoteWrite = false, driver?: string): void {
  writeFileSync(
    join(workspace, 'goal-compass.json'),
    JSON.stringify(
      {
        missionId: 'prueba-hook',
        objective: 'Encadenar un objetivo desde el hook',
        defaultTokenBudget: 60000,
        allowRemoteWrite,
        ...(driver ? { driver } : {}),
        backlog: [
          {
            candidateId: 'trabajo-1',
            objective: 'Revisar el fichero de notas del repositorio',
            whyNow: 'Es el primer trabajo de la mision',
            evidenceRefs: ['NOTAS.md'],
            doneWhen: ['Las notas estan revisadas'],
            risk: 'low',
            priority: 10,
            source: 'roadmap',
          },
        ],
      },
      null,
      2,
    ),
    'utf8',
  );
}

describe('hook de continuacion', () => {
  let workspace: string;
  let stateHome: string;
  let previousStateHome: string | undefined;

  beforeEach(() => {
    workspace = tempDir('gcl-hook-');
    stateHome = tempDir('gcl-state-');
    previousStateHome = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = stateHome;
    writeMission(workspace);
  });

  afterEach(() => {
    if (previousStateHome === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = previousStateHome;
  });

  /**
   * El objetivo que el host recibio en el ultimo encadenado.
   *
   * Es la unica via por la que el agente lee lo que el plugin tiene que
   * decirle: el host entrega el objetivo en un turno propio y no hay otro
   * mensaje. Por eso las pruebas miran aqui y no la salida del hook.
   */
  function objetivoDelHost(): string {
    const journal = JSON.parse(
      readFileSync(join(stateHome, 'goal-compass', 'prueba-hook', 'journal.json'), 'utf8'),
    ) as { intents: { hostObjective: string }[] };
    return journal.intents[journal.intents.length - 1]?.hostObjective ?? '';
  }

  it('encuentra la declaracion de la mision en el workspace', () => {
    expect(findMissionFile(workspace)).toBe(join(workspace, 'goal-compass.json'));

    const nested = tempDir('gcl-hook-nested-');
    mkdirSync(join(nested, '.goal-compass'));
    writeFileSync(join(nested, '.goal-compass', 'mission.json'), '{}');
    expect(findMissionFile(nested)).toBe(join(nested, '.goal-compass', 'mission.json'));

    expect(findMissionFile(tempDir('gcl-hook-vacio-'))).toBeNull();
  });

  it('interpreta el evento del host y descarta lo que no es un evento', () => {
    const event = parseHookEvent(
      JSON.stringify({ hook_event_name: 'Stop', session_id: 'mvs_1', cwd: '/tmp' }),
    );
    expect(event?.session_id).toBe('mvs_1');
    expect(parseHookEvent('esto no es json')).toBeNull();
    expect(parseHookEvent('')).toBeNull();
  });

  it('el limite de publicacion de la mision llega al agente', async () => {
    await runAutoContinue(JSON.stringify({ session_id: 'mvs_fake', cwd: workspace }), {
      host: HOST,
      logger: quietLogger,
    });
    expect(objetivoDelHost()).toContain('no autoriza publicar');
  });

  it('el objetivo lleva el contexto de la mision', async () => {
    await runAutoContinue(JSON.stringify({ session_id: 'mvs_fake', cwd: workspace }), {
      host: HOST,
      logger: quietLogger,
    });
    const objetivo = objetivoDelHost();
    expect(objetivo).toContain('Contexto de la mision');
    expect(objetivo).toContain('presupuesto');
    expect(objetivo).toContain('trabajo declarado pendiente');
  });

  it('el objetivo pide dejar el trabajo siguiente', async () => {
    await runAutoContinue(JSON.stringify({ session_id: 'mvs_fake', cwd: workspace }), {
      host: HOST,
      logger: quietLogger,
    });
    const objetivo = objetivoDelHost();
    expect(objetivo).toContain('mission_propose');
    expect(objetivo).toContain('deja el trabajo siguiente');
  });

  it('el objetivo nombra la evidencia y el criterio de cierre', async () => {
    await runAutoContinue(JSON.stringify({ session_id: 'mvs_fake', cwd: workspace }), {
      host: HOST,
      logger: quietLogger,
    });
    const objetivo = objetivoDelHost();
    expect(objetivo).toContain('Evidencia: NOTAS.md');
    expect(objetivo).toContain('Criterio de cierre:');
    expect(objetivo).toContain('Las notas estan revisadas');
  });

  it('el objetivo sin presupuesto se reintenta con mas margen en vez de quedarse esperando', async () => {
    // El primer turno encadena el objetivo.
    await runAutoContinue(JSON.stringify({ session_id: 'mvs_fake', cwd: workspace }), {
      host: HOST,
      logger: quietLogger,
    });
    expect(objetivoDelHost()).toContain('Revisar el fichero de notas');

    // El host devuelve ese mismo objetivo, ya sin presupuesto.
    process.env.FAKE_ACP_SEED_GOAL = 'budget_limited';
    process.env.FAKE_ACP_SEED_ID = 'tg_fake_1';
    process.env.FAKE_ACP_SEED_BUDGET = '60000';
    try {
      await runAutoContinue(JSON.stringify({ session_id: 'mvs_fake', cwd: workspace }), {
        host: HOST,
        logger: quietLogger,
      });
    } finally {
      delete process.env.FAKE_ACP_SEED_GOAL;
      delete process.env.FAKE_ACP_SEED_ID;
      delete process.env.FAKE_ACP_SEED_BUDGET;
    }

    const objetivo = objetivoDelHost();
    expect(objetivo).toContain('se quedo sin presupuesto');
    expect(objetivo).toContain('reintentado con mas margen');

    // El trabajo vuelve a la cola con el doble de presupuesto, y el intento
    // agotado queda anotado con su coste.
    const state = JSON.parse(
      readFileSync(join(stateHome, 'goal-compass', 'prueba-hook', 'journal.json'), 'utf8'),
    ) as Journal;
    expect(state.budgetAttempts).toHaveLength(1);
    expect(state.budgetAttempts[0]?.tokenBudget).toBe(60_000);
    const committed = state.intents.filter((intent) => intent.status === 'committed');
    expect(committed).toHaveLength(2);
    expect(committed[1]?.tokenBudget).toBe(120_000);
    expect(committed[1]?.candidateKey).toBe(committed[0]?.candidateKey);
  });

  it('una mision que autoriza publicar lo dice sin dar permiso por su cuenta', async () => {
    const otro = tempDir('gcl-hook-publica-');
    writeMission(otro, true);
    await runAutoContinue(JSON.stringify({ session_id: 'mvs_fake', cwd: otro }), {
      host: HOST,
      logger: quietLogger,
    });
    const objetivo = objetivoDelHost();
    expect(objetivo).toContain('autoriza publicar');
    expect(objetivo).toContain('autorizacion explicita del usuario');
  });

  it('no hace nada cuando la mision la conduce otro camino', async () => {
    const otro = tempDir('gcl-hook-supervisor-');
    writeMission(otro, false, 'supervisor');
    const salida = await runAutoContinue(
      JSON.stringify({ session_id: 'mvs_fake', cwd: otro }),
      { host: HOST, logger: quietLogger },
    );
    expect(salida).toBe('');
  });

  it('no hace nada cuando el workspace no declara una mision', async () => {
    const vacio = tempDir('gcl-hook-sin-');
    const salida = await runAutoContinue(
      JSON.stringify({ session_id: 'mvs_fake', cwd: vacio }),
      { host: HOST, logger: quietLogger },
    );
    expect(salida).toBe('');
  });

  it('crea el siguiente objetivo en la sesion del evento y deja el turno al host', async () => {
    const salida = await runAutoContinue(
      JSON.stringify({ session_id: 'mvs_fake', cwd: workspace }),
      { host: HOST, logger: quietLogger },
    );

    // El hook no alarga el turno. El host cierra el turno y entrega el
    // objetivo recien creado en un turno propio, y en ese turno el agente
    // sigue teniendo herramientas: alargar el turno aqui es lo que se las
    // quita, porque el host ya no puede entregarles el resultado.
    expect(salida).toBe('');

    const journal = JSON.parse(
      readFileSync(join(stateHome, 'goal-compass', 'prueba-hook', 'journal.json'), 'utf8'),
    ) as {
      sessionId: string;
      intents: { status: string; goalId?: string; hostObjective: string }[];
    };
    expect(journal.sessionId).toBe('mvs_fake');
    expect(journal.intents).toHaveLength(1);
    expect(journal.intents[0]?.status).toBe('committed');
    expect(journal.intents[0]?.goalId).toBeTruthy();
    expect(journal.intents[0]?.hostObjective).toContain('Revisar el fichero de notas');
  });

  it('no rompe el turno cuando el host falla', async () => {
    const salida = await runAutoContinue(
      JSON.stringify({ session_id: 'mvs_fake', cwd: workspace }),
      { host: { command: '/bin/false', args: [] }, logger: quietLogger },
    );
    expect(salida).toBe('');
  });

  it('no rompe el turno cuando el tiempo se acaba', async () => {
    const salida = await runAutoContinue(
      JSON.stringify({ session_id: 'mvs_fake', cwd: workspace }),
      { host: HOST, deadlineMs: 1, logger: quietLogger },
    );
    expect(salida).toBe('');
  });
});

describe('el hook como proceso', () => {
  let workspace: string;
  let stateHome: string;
  let previousStateHome: string | undefined;
  let binDir: string;

  beforeEach(() => {
    workspace = tempDir('gcl-proceso-');
    stateHome = tempDir('gcl-proceso-estado-');
    binDir = tempDir('gcl-proceso-bin-');
    previousStateHome = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = stateHome;
    writeMission(workspace);

    // El hook arranca el host por su nombre: aqui se le da el host de
    // mentira, sin tocar el codigo de produccion.
    writeFileSync(
      join(binDir, 'mcode'),
      `#!/bin/sh\nexec "${process.execPath}" "${HOST_SCRIPT}" "$@"\n`,
      { mode: 0o755 },
    );
  });

  afterEach(() => {
    if (previousStateHome === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = previousStateHome;
  });

  it('termina aunque el host falle, sin quedarse colgado', async () => {
    const { code, elapsed, out } = await runHookProcess(workspace, binDir, {
      FAKE_ACP_FAIL: 'initialize',
    });

    expect(code).toBe(0);
    expect(elapsed).toBeLessThan(20_000);
    expect(out).toBe('');
  });

  it('termina aunque el host no conteste', async () => {
    // Un host que no dice nada: el hook tiene que rendirse, no esperar.
    const mudo = tempDir('gcl-proceso-mudo-');
    writeFileSync(join(mudo, 'mcode'), '#!/bin/sh\nsleep 300\n', { mode: 0o755 });

    const { code, elapsed } = await runHookProcess(workspace, mudo, {
      GOAL_COMPASS_REQUEST_TIMEOUT_MS: '2000',
    });

    expect(code).toBe(0);
    expect(elapsed).toBeLessThan(20_000);
  });
});

describe('ensamblado del plugin', () => {
  it('deja el paquete con manifiesto, skill, hook y supervisor compilado', async () => {
    const projectRoot = tempDir('gcl-proyecto-');
    const marketplace = tempDir('gcl-market-');

    mkdirSync(join(projectRoot, 'plugin', '.minimax-plugin'), { recursive: true });
    mkdirSync(join(projectRoot, 'plugin', 'hooks'), { recursive: true });
    mkdirSync(join(projectRoot, 'plugin', 'mcpServers'), { recursive: true });
    mkdirSync(join(projectRoot, 'skill', PLUGIN_NAME), { recursive: true });
    mkdirSync(join(projectRoot, 'dist', 'plugin'), { recursive: true });

    writeFileSync(
      join(projectRoot, 'plugin', '.minimax-plugin', 'plugin.json'),
      '{"name":"goal-compass"}',
      'utf8',
    );
    writeFileSync(join(projectRoot, 'plugin', 'hooks', 'auto-continue.json'), '{}', 'utf8');
    writeFileSync(
      join(projectRoot, 'plugin', 'mcpServers', 'goal-compass.mcp.json'),
      '{"schemaVersion":1,"mcpServers":{}}',
      'utf8',
    );
    writeFileSync(join(projectRoot, 'plugin', 'icon.png'), 'png', 'utf8');
    writeFileSync(join(projectRoot, 'skill', PLUGIN_NAME, 'SKILL.md'), '# skill', 'utf8');
    writeFileSync(join(projectRoot, 'dist', 'plugin', 'auto-continue.js'), '//', 'utf8');

    const target = await installPlugin({
      projectRoot,
      marketplaceDir: marketplace,
      logger: quietLogger,
    });

    expect(existsSync(join(target, '.minimax-plugin', 'plugin.json'))).toBe(true);
    expect(existsSync(join(target, 'hooks', 'auto-continue.json'))).toBe(true);
    expect(existsSync(join(target, 'mcpServers', 'goal-compass.mcp.json'))).toBe(true);
    expect(existsSync(join(target, 'icon.png'))).toBe(true);
    expect(existsSync(join(target, 'skills', PLUGIN_NAME, 'SKILL.md'))).toBe(true);
    expect(existsSync(join(target, 'dist', 'plugin', 'auto-continue.js'))).toBe(true);

    const packageJson = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')) as {
      type: string;
    };
    expect(packageJson.type).toBe('module');
  });

  it('se niega a ensamblar sin el supervisor compilado', async () => {
    const projectRoot = tempDir('gcl-proyecto-vacio-');
    const marketplace = tempDir('gcl-market-vacio-');
    await expect(
      installPlugin({ projectRoot, marketplaceDir: marketplace, logger: quietLogger }),
    ).rejects.toThrow(/compilado/);
  });
});
