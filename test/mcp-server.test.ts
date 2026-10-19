/**
 * Servidor de herramientas de la misión.
 *
 * Se comprueba el protocolo (inicializar, listar y llamar) y el
 * comportamiento de las herramientas: qué se ve sin misión, cómo se
 * registra una propuesta y qué pasa cuando la evidencia no existe.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildMissionTools, handleMessage, resolveWorkspaceDir } from '../src/plugin/mcp-server.js';
import { findMissionFileUpwards, locateMission } from '../src/plugin/mission-locator.js';
import { proposalsPath, readProposals } from '../src/adapters/proposals.js';
import type { Logger } from '../src/ports.js';

const quietLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function writeMission(workspace: string, missionId = 'prueba-mcp'): void {
  writeFileSync(
    join(workspace, 'goal-compass.json'),
    JSON.stringify({
      missionId,
      objective: 'Comprobar las herramientas de la mision',
      defaultTokenBudget: 60000,
      backlog: [
        {
          candidateId: 'revisar-notas',
          objective: 'Revisar las notas del repositorio',
          whyNow: 'Es el trabajo declarado',
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
  writeFileSync(join(workspace, 'NOTAS.md'), 'notas\n', 'utf8');
}

async function callTool(
  tools: ReturnType<typeof buildMissionTools>,
  name: string,
  args: Record<string, unknown> = {},
): Promise<string> {
  const result = (await handleMessage(
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
    tools,
  )) as { content: { text: string }[]; isError?: boolean };
  return result.content[0]?.text ?? '';
}

describe('servidor de herramientas de la mision', () => {
  let workspace: string;
  let stateHome: string;
  let previousStateHome: string | undefined;

  beforeEach(() => {
    workspace = tempDir('gcl-mcp-');
    stateHome = tempDir('gcl-mcp-state-');
    previousStateHome = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = stateHome;
    writeMission(workspace);
  });

  afterEach(() => {
    if (previousStateHome === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = previousStateHome;
  });

  it('anuncia las herramientas y responde a la inicializacion', async () => {
    const tools = buildMissionTools({ cwd: workspace, logger: quietLogger });

    const init = (await handleMessage(
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
      tools,
    )) as { protocolVersion: string; capabilities: { tools: unknown } };
    expect(init.protocolVersion).toBe('2024-11-05');
    expect(init.capabilities.tools).toBeDefined();

    const list = (await handleMessage(
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      tools,
    )) as { tools: { name: string }[] };
    expect(list.tools.map((tool) => tool.name).sort()).toEqual([
      'mission_pause',
      'mission_propose',
      'mission_resume',
      'mission_status',
      'mission_stop',
    ]);
  });

  it('no responde a las notificaciones', async () => {
    const tools = buildMissionTools({ cwd: workspace, logger: quietLogger });
    const result = await handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, tools);
    expect(result).toBeNull();
  });

  it('explica que no hay mision cuando el workspace no declara ninguna', async () => {
    const tools = buildMissionTools({ cwd: tempDir('gcl-mcp-sin-'), logger: quietLogger });
    const text = await callTool(tools, 'mission_status');
    expect(text).toContain('No hay ninguna misión declarada');
  });

  it('muestra la mision declarada y el trabajo disponible', async () => {
    const tools = buildMissionTools({ cwd: workspace, logger: quietLogger });
    const text = await callTool(tools, 'mission_status');
    expect(text).toContain('prueba-mcp');
    expect(text).toContain('Revisar las notas del repositorio');
  });

  it('registra una propuesta con evidencia real', async () => {
    const tools = buildMissionTools({ cwd: workspace, logger: quietLogger });
    const text = await callTool(tools, 'mission_propose', {
      objective: 'Escribir la prueba que falta',
      evidence: 'NOTAS.md',
    });
    expect(text).toContain('Propuesta registrada');
    expect(readProposals('prueba-mcp')).toHaveLength(1);
    expect(existsSync(proposalsPath('prueba-mcp'))).toBe(true);
  });

  it('descarta una propuesta cuya evidencia no existe', async () => {
    const tools = buildMissionTools({ cwd: workspace, logger: quietLogger });
    const text = await callTool(tools, 'mission_propose', {
      objective: 'Trabajo sobre un fichero inexistente',
      evidence: 'INVENTADO.md',
    });
    expect(text).toContain('no señala a ningún fichero');
    expect(readProposals('prueba-mcp')).toHaveLength(0);
  });

  it('escribe la orden de pausa en el canal de control', async () => {
    const tools = buildMissionTools({ cwd: workspace, logger: quietLogger });
    const text = await callTool(tools, 'mission_pause');
    expect(text).toContain('pausada');

    const control = JSON.parse(
      readFileSync(join(stateHome, 'goal-compass', 'prueba-mcp', 'journal.json.control'), 'utf8'),
    ) as { status: string };
    expect(control.status).toBe('paused_by_user');
  });

  it('busca la mision hacia arriba desde un subdirectorio', () => {
    const nested = join(workspace, 'src', 'adapters');
    writeMission(workspace);
    expect(findMissionFileUpwards(nested)).toBe(join(workspace, 'goal-compass.json'));
    expect(locateMission(nested)?.workspace).toBe(workspace);
  });

  it('usa el directorio del proyecto que publica el host', () => {
    expect(resolveWorkspaceDir({ MINIMAX_PROJECT_DIR: '/tmp/proyecto' })).toBe('/tmp/proyecto');
    expect(resolveWorkspaceDir({})).toBe(process.cwd());
  });

  it('usa el directorio de la shell cuando el host solo publica PWD', () => {
    // El host lanza el servidor desde su propia carpeta: PWD es lo unico que
    // senala al proyecto en ese caso.
    expect(resolveWorkspaceDir({ PWD: workspace })).toBe(workspace);
  });

  it('ignora un PWD que no existe', () => {
    expect(resolveWorkspaceDir({ PWD: '/ruta/que/no/existe' })).toBe(process.cwd());
  });
});
