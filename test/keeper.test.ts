/**
 * El proceso vivo: un host que se queda con la sesion cargada.
 *
 * El host solo deja crear un objetivo sobre una sesion que este cargada en
 * el proceso que habla con el, y cargar la sesion es lo caro: hay que leer
 * todo su historial. Estos tests comprueban que el proceso vivo resuelve esa
 * parte: el socket responde, crea objetivos, y el hook los crea por ahi sin
 * abrir un host nuevo.
 *
 * El host ACP de mentira es el mismo que usan las demas pruebas: es un
 * proceso real que habla el protocolo de verdad.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanupTempDirs, tempDir } from './support/temp.js';
import { KeeperGoalAdapter } from '../src/adapters/keeper-goal.js';
import { runAutoContinue } from '../src/plugin/auto-continue.js';
import { keeperSocketPath } from '../src/plugin/keeper-protocol.js';
import { isInternalSession } from '../src/plugin/host-keeper.js';
import { runSessionHook } from '../src/plugin/session-hooks.js';
import type { Logger } from '../src/ports.js';

const TSX = join(process.cwd(), 'node_modules', '.bin', 'tsx');
const KEEPER = fileURLToPath(new URL('../src/plugin/host-keeper.ts', import.meta.url));
const HOST_SCRIPT = fileURLToPath(new URL('./support/fake-acp-host.mjs', import.meta.url));

const quietLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };

/** Espera a que una condicion se cumpla, sin pasarse de la paciencia. */
async function waitFor(check: () => boolean, ms = 10_000): Promise<boolean> {
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return check();
}

/** Declara una mision minima en el workspace. */
function writeMission(workspace: string): void {
  writeFileSync(
    join(workspace, 'goal-compass.json'),
    JSON.stringify({
      missionId: 'prueba-vivo',
      objective: 'Encadenar un objetivo desde el hook',
      defaultTokenBudget: 60000,
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
    }),
    'utf8',
  );
}

describe('proceso vivo', () => {
  let workspace: string;
  let stateHome: string;
  let previousStateHome: string | undefined;
  let keeper: ChildProcess | undefined;

  beforeEach(() => {
    workspace = tempDir('gcl-vivo-');
    stateHome = tempDir('gcl-vivo-estado-');
    previousStateHome = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = stateHome;
    writeMission(workspace);
  });

  afterEach(() => {
    keeper?.kill('SIGKILL');
    keeper = undefined;
    if (previousStateHome === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = previousStateHome;
    cleanupTempDirs();
  });

  /** Levanta el proceso vivo con el host de mentira. */
  function startKeeper(sessionId: string): string {
    const socketPath = keeperSocketPath(sessionId);
    keeper = spawn(
      TSX,
      [
        KEEPER,
        '--session',
        sessionId,
        '--workspace',
        workspace,
        '--socket',
        socketPath,
        '--owner',
        String(process.pid),
        '--host',
        process.execPath,
        '--host-args',
        JSON.stringify([HOST_SCRIPT]),
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, XDG_STATE_HOME: stateHome },
        stdio: 'ignore',
      },
    );
    return socketPath;
  }

  it('la ruta del socket es corta y distinta para cada sesion', () => {
    const uno = keeperSocketPath('mvs_una');
    const otro = keeperSocketPath('mvs_otra');

    expect(uno).toBe(keeperSocketPath('mvs_una'));
    expect(uno).not.toBe(otro);
    // El nombre de un socket tiene un limite corto: por eso el identificador
    // de la sesion se resume.
    expect(uno.length).toBeLessThan(100);
    expect(uno.startsWith(join(stateHome, 'goal-compass', 'keepers'))).toBe(true);
  });

  it('responde por el socket y crea el objetivo en la sesion', async () => {
    const sessionId = 'mvs_vivo';
    const socketPath = startKeeper(sessionId);

    const listo = await waitFor(() => existsSync(socketPath));
    expect(listo).toBe(true);

    const adapter = new KeeperGoalAdapter({
      sessionId,
      socketPath,
      logger: quietLogger,
      requestTimeoutMs: 5_000,
    });
    await adapter.start();
    expect(await adapter.ping()).toBe(true);

    const goal = await adapter.create(sessionId, 'un objetivo nuevo', 60000);
    expect(goal.goalId).toBeTruthy();
    expect(goal.objective).toBe('un objetivo nuevo');

    await adapter.close();
  });

  it('el hook crea el objetivo por el proceso vivo sin abrir un host nuevo', async () => {
    const sessionId = 'mvs_vivo';
    const socketPath = startKeeper(sessionId);
    expect(await waitFor(() => existsSync(socketPath))).toBe(true);

    // El host del camino de reserva esta roto a proposito: si el objetivo se
    // crea igual, es que ha pasado por el proceso vivo.
    const salida = await runAutoContinue(
      JSON.stringify({ session_id: sessionId, cwd: workspace }),
      { host: { command: '/bin/false', args: [] }, logger: quietLogger },
    );

    expect(salida).not.toBe('');
    const decision = JSON.parse(salida) as { decision: string; reason: string };
    expect(decision.decision).toBe('block');
    expect(decision.reason).toContain('Revisar el fichero de notas');

    const journal = JSON.parse(
      readFileSync(join(stateHome, 'goal-compass', 'prueba-vivo', 'journal.json'), 'utf8'),
    ) as { sessionId: string; intents: { status: string; goalId?: string }[] };
    expect(journal.sessionId).toBe(sessionId);
    expect(journal.intents[0]?.status).toBe('committed');
    expect(journal.intents[0]?.goalId).toBeTruthy();
  });

  it('el hook cae al camino de reserva cuando no hay proceso vivo', async () => {
    const salida = await runAutoContinue(
      JSON.stringify({ session_id: 'mvs_sin_vivo', cwd: workspace }),
      {
        host: { command: process.execPath, args: [HOST_SCRIPT] },
        logger: quietLogger,
      },
    );

    expect(salida).not.toBe('');
    const decision = JSON.parse(salida) as { decision: string };
    expect(decision.decision).toBe('block');
  });

  it('el hook de inicio levanta el proceso vivo y el de fin lo apaga', async () => {
    const sessionId = 'mvs_ciclo';
    const socketPath = keeperSocketPath(sessionId);

    const inicio = await runSessionHook(
      JSON.stringify({ hook_event_name: 'SessionStart', session_id: sessionId, cwd: workspace }),
      {
        logger: quietLogger,
        keeper: {
          command: TSX,
          args: [KEEPER, '--host', process.execPath, '--host-args', JSON.stringify([HOST_SCRIPT])],
        },
        ownerPid: process.pid,
      },
    );
    expect(inicio).toBe('');

    expect(await waitFor(() => existsSync(socketPath))).toBe(true);

    const fin = await runSessionHook(
      JSON.stringify({ hook_event_name: 'SessionEnd', session_id: sessionId, cwd: workspace }),
      { logger: quietLogger },
    );
    expect(fin).toBe('');
    expect(await waitFor(() => !existsSync(socketPath))).toBe(true);
  }, 20_000);

  it('el hook de inicio no levanta nada cuando el workspace no declara mision', async () => {
    const vacio = tempDir('gcl-vivo-sin-mision-');
    const sessionId = 'mvs_sin_mision';

    await runSessionHook(
      JSON.stringify({ hook_event_name: 'SessionStart', session_id: sessionId, cwd: vacio }),
      {
        logger: quietLogger,
        keeper: { command: TSX, args: [KEEPER] },
        ownerPid: process.pid,
      },
    );

    expect(existsSync(keeperSocketPath(sessionId))).toBe(false);
  });

  it('el proceso vivo se apaga cuando no puede cargar la sesion', async () => {
    // Si la sesion no se puede abrir, el proceso vivo no puede hacer su
    // trabajo: se apaga y deja que el hook use el camino de reserva.
    const sessionId = 'mvs_interna';
    const socketPath = keeperSocketPath(sessionId);
    keeper = spawn(
      TSX,
      [
        KEEPER,
        '--session',
        sessionId,
        '--workspace',
        workspace,
        '--socket',
        socketPath,
        '--owner',
        String(process.pid),
        '--host',
        process.execPath,
        '--host-args',
        JSON.stringify([HOST_SCRIPT]),
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, XDG_STATE_HOME: stateHome, FAKE_ACP_FAIL: 'session/load' },
        stdio: 'ignore',
      },
    );

    expect(await waitFor(() => existsSync(socketPath), 10_000)).toBe(true);
    expect(await waitFor(() => !existsSync(socketPath), 30_000)).toBe(true);
  }, 45_000);

  it('el proceso vivo se apaga sin reintentar cuando la sesion es interna', () => {
    expect(isInternalSession('Invalid params: Sub-agent Sessions are internal and cannot be opened.')).toBe(
      true,
    );
    expect(isInternalSession('Resource not found')).toBe(false);
    expect(isInternalSession('el host no contesta')).toBe(false);
  });
});
