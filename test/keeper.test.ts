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
import { existsSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
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
  function startKeeper(sessionId: string, extraEnv: Record<string, string> = {}): string {
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
        env: { ...process.env, XDG_STATE_HOME: stateHome, ...extraEnv },
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

  it('responde el objetivo sin preguntar a un host que ya no contesta', async () => {
    // El caso que rompe la cadena: mientras el hook corre, el host que tiene
    // el objetivo esta ocupado. Preguntarle y esperar deja el turno sin
    // continuacion. El proceso vivo tiene que responder con lo que ya sabe.
    const sessionId = 'mvs_vivo';
    const socketPath = startKeeper(sessionId, {
      FAKE_ACP_SEED_GOAL: 'active',
      FAKE_ACP_FREEZE_AFTER_MS: '250',
      GOAL_COMPASS_KEEPER_READ_MS: '150',
    });
    expect(await waitFor(() => existsSync(socketPath))).toBe(true);
    // Se espera a que el proceso vivo cargue la sesion y a que el host se
    // congele: a partir de ese momento, preguntar no devuelve nada.
    await new Promise((resolve) => setTimeout(resolve, 600));

    const adapter = new KeeperGoalAdapter({
      sessionId,
      socketPath,
      logger: quietLogger,
      requestTimeoutMs: 5_000,
    });
    await adapter.start();
    const goal = await adapter.read(sessionId);
    expect(goal?.goalId).toBe('tg_fake_1');
    expect(goal?.status).toBe('active');

    await adapter.close();
  }, 20_000);

  it('el objetivo que cambia fuera se ve igual sin avisar', async () => {
    // El aviso de cambio se pierde y el objetivo se reanuda en el host: lo que
    // hay guardado sigue diciendo "pausado" mientras el real ya es "activo".
    // Servir solo lo guardado congelaria la cadena sobre una verdad vieja y para
    // siempre — decide que el objetivo esta parado cuando lo unico que se sabe
    // es que hace rato que no se pregunta.
    const sessionId = 'mvs_vivo';
    const socketPath = startKeeper(sessionId, {
      FAKE_ACP_SEED_GOAL: 'paused',
      FAKE_ACP_DRIFT_AFTER_MS: '400',
      FAKE_ACP_DRIFT_STATUS: 'active',
      GOAL_COMPASS_KEEPER_FRESH_MS: '150',
      GOAL_COMPASS_KEEPER_READ_MS: '2000',
    });
    expect(await waitFor(() => existsSync(socketPath))).toBe(true);

    const adapter = new KeeperGoalAdapter({
      sessionId,
      socketPath,
      logger: quietLogger,
      requestTimeoutMs: 5_000,
    });
    await adapter.start();

    // Se espera a que el host haya cambiado el objetivo por su cuenta.
    await new Promise((resolve) => setTimeout(resolve, 900));

    // La lectura no espera al host: sale con lo que ya se sabe.
    const antes = await adapter.read(sessionId);
    expect(antes?.status).toBe('paused');

    // Y a la vuelta siguiente ya sale al dia, sin que nadie lo pidiera.
    let despues = antes;
    const limite = Date.now() + 5_000;
    while (despues?.status !== 'active' && Date.now() < limite) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      despues = await adapter.read(sessionId);
    }
    expect(despues?.status).toBe('active');

    await adapter.close();
  }, 20_000);

  it('se retira cuando el plugin de debajo ya no es el suyo', async () => {
    // Este proceso vive horas con la sesion cargada. Si el plugin se actualiza
    // mientras tanto, seguir sirviendo deja la cadena decidiendo con el codigo
    // de antes: lo que se acaba de arreglar no se nota hasta el reinicio, y
    // entonces parece que la correccion no servia. Retirandose deja el socket
    // fuera, el hook vuelve a su camino de reserva y el siguiente arranque trae
    // el codigo nuevo.
    const sessionId = 'mvs_vivo';
    const socketPath = startKeeper(sessionId, { FAKE_ACP_SEED_GOAL: 'active' });
    expect(await waitFor(() => existsSync(socketPath))).toBe(true);

    const adapter = new KeeperGoalAdapter({
      sessionId,
      socketPath,
      logger: quietLogger,
      requestTimeoutMs: 5_000,
    });
    await adapter.start();
    expect((await adapter.read(sessionId))?.status).toBe('active');

    // Solo cambia cuando se escribio el fichero, no su contenido.
    const antes = statSync(KEEPER).mtimeMs;
    const ahora = new Date(antes + 60_000);
    utimesSync(KEEPER, ahora, ahora);

    let fallo: string | undefined;
    try {
      await adapter.read(sessionId);
    } catch (err) {
      fallo = (err as Error).message;
    }

    expect(fallo).toBeTruthy();
    expect(await waitFor(() => !existsSync(socketPath))).toBe(true);

    await adapter.close();
  }, 20_000);

  it('el objetivo recien creado se lee al instante, sin esperar al aviso de cambio', async () => {
    // El aviso de cambio del host llega despues de crear. Hasta que llega,
    // leer tiene que dar el objetivo nuevo: dar el anterior —que ademas
    // puede estar completo— habilita encadenar otra vez sin querer.
    const sessionId = 'mvs_vivo';
    const socketPath = startKeeper(sessionId, { FAKE_ACP_SEED_GOAL: 'complete' });
    expect(await waitFor(() => existsSync(socketPath))).toBe(true);

    const adapter = new KeeperGoalAdapter({
      sessionId,
      socketPath,
      logger: quietLogger,
      requestTimeoutMs: 5_000,
    });
    await adapter.start();

    // El proceso vivo carga la sesion al arrancar; se espera a que sepa cual
    // es el objetivo antes de compararlo con el nuevo.
    let antes = await adapter.read(sessionId);
    const limite = Date.now() + 5_000;
    while (antes?.goalId !== 'tg_fake_1' && Date.now() < limite) {
      await new Promise((r) => setTimeout(r, 50));
      antes = await adapter.read(sessionId);
    }
    expect(antes?.goalId).toBe('tg_fake_1');

    const creado = await adapter.create(sessionId, 'Un trabajo nuevo', 60_000);
    expect(creado.goalId).toBe('tg_fake_2');

    const despues = await adapter.read(sessionId);
    expect(despues?.goalId).toBe('tg_fake_2');

    await adapter.close();
  }, 20_000);

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

    // El hook no alarga el turno: el host entrega el objetivo en un turno
    // propio, y ahi el agente conserva las herramientas.
    expect(salida).toBe('');

    const journal = JSON.parse(
      readFileSync(join(stateHome, 'goal-compass', 'prueba-vivo', 'journal.json'), 'utf8'),
    ) as {
      sessionId: string;
      intents: { status: string; goalId?: string; hostObjective: string }[];
    };
    expect(journal.sessionId).toBe(sessionId);
    expect(journal.intents[0]?.status).toBe('committed');
    expect(journal.intents[0]?.goalId).toBeTruthy();
    expect(journal.intents[0]?.hostObjective).toContain('Revisar el fichero de notas');
  });

  it('el hook cae al camino de reserva cuando no hay proceso vivo', async () => {
    const salida = await runAutoContinue(
      JSON.stringify({ session_id: 'mvs_sin_vivo', cwd: workspace }),
      {
        host: { command: process.execPath, args: [HOST_SCRIPT] },
        logger: quietLogger,
      },
    );

    expect(salida).toBe('');
    const journal = JSON.parse(
      readFileSync(join(stateHome, 'goal-compass', 'prueba-vivo', 'journal.json'), 'utf8'),
    ) as { intents: { status: string; hostObjective: string }[] };
    expect(journal.intents[0]?.status).toBe('committed');
    expect(journal.intents[0]?.hostObjective).toContain('Revisar el fichero de notas');
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
        env: {
          ...process.env,
          XDG_STATE_HOME: stateHome,
          FAKE_ACP_FAIL: 'session/load',
          GOAL_COMPASS_KEEPER_RETRY_MS: '80',
        },
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
