/**
 * Plugin de MCode: el hook de continuacion y el ensamblado del paquete.
 *
 * El hook se prueba contra el host ACP de mentira, que es un proceso real:
 * lo que se comprueba es que el objetivo se crea en la sesion del evento y
 * que el turno continua, sin tocar el host real.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHookEvent, runAutoContinue } from '../src/plugin/auto-continue.js';
import { findMissionFile, findMissionFileUpwards } from '../src/plugin/mission-locator.js';
import { installPlugin, PLUGIN_NAME } from '../src/plugin/install.js';
import type { Logger } from '../src/ports.js';

const HOST_SCRIPT = fileURLToPath(new URL('./support/fake-acp-host.mjs', import.meta.url));
const HOST = { command: process.execPath, args: [HOST_SCRIPT] };

const quietLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
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
    const salida = await runAutoContinue(
      JSON.stringify({ session_id: 'mvs_fake', cwd: workspace }),
      { host: HOST, logger: quietLogger },
    );
    const decision = JSON.parse(salida) as { reason: string };
    expect(decision.reason).toContain('no autoriza publicar');
  });

  it('una mision que autoriza publicar lo dice sin dar permiso por su cuenta', async () => {
    const otro = tempDir('gcl-hook-publica-');
    writeMission(otro, true);
    const salida = await runAutoContinue(
      JSON.stringify({ session_id: 'mvs_fake', cwd: otro }),
      { host: HOST, logger: quietLogger },
    );
    const decision = JSON.parse(salida) as { reason: string };
    expect(decision.reason).toContain('autoriza publicar');
    expect(decision.reason).toContain('autorizacion explicita del usuario');
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

  it('crea el siguiente objetivo en la sesion del evento y pide continuar', async () => {
    const salida = await runAutoContinue(
      JSON.stringify({ session_id: 'mvs_fake', cwd: workspace }),
      { host: HOST, logger: quietLogger },
    );

    expect(salida).not.toBe('');
    const decision = JSON.parse(salida) as { decision: string; reason: string };
    expect(decision.decision).toBe('block');
    expect(decision.reason).toContain('Revisar el fichero de notas');

    const journal = JSON.parse(
      readFileSync(join(stateHome, 'goal-compass', 'prueba-hook', 'journal.json'), 'utf8'),
    ) as { sessionId: string; intents: { status: string; goalId?: string }[] };
    expect(journal.sessionId).toBe('mvs_fake');
    expect(journal.intents).toHaveLength(1);
    expect(journal.intents[0]?.status).toBe('committed');
    expect(journal.intents[0]?.goalId).toBeTruthy();
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
