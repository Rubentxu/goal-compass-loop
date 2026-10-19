import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceEvidenceScanner } from '../src/adapters/discovery.js';
import { WorkspaceDiscovery } from '../src/adapters/candidates.js';
import { aMission } from './support/harness.js';

function workspaceWith(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'gcl-ws-'));
  for (const [relative, content] of Object.entries(files)) {
    const full = join(root, relative);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

describe('WorkspaceEvidenceScanner · senales de trabajo pendiente', () => {
  it('encuentra un pendiente marcado en el codigo', async () => {
    const workspace = workspaceWith({
      'src/parser.ts': ['export function parse() {', '  // TODO: no soporta arrays anidados', '}'].join('\n'),
    });

    const evidence = await new WorkspaceEvidenceScanner().scan(workspace);

    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.kind).toBe('pending-marker');
    expect(evidence[0]?.location).toBe('src/parser.ts:2');
    expect(evidence[0]?.objective).toContain('src/parser.ts:2');
    expect(evidence[0]?.doneWhen.length).toBeGreaterThan(0);
  });

  it('encuentra una prueba omitida', async () => {
    const workspace = workspaceWith({
      'test/parser.test.ts': "it.skip('deberia analizar arrays anidados', () => {});",
    });

    const evidence = await new WorkspaceEvidenceScanner().scan(workspace);

    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.kind).toBe('skipped-test');
    expect(evidence[0]?.location).toBe('test/parser.test.ts:1');
  });

  it('ignora los directorios que no aportan trabajo', async () => {
    const workspace = workspaceWith({
      'src/app.ts': '// TODO: revisar esto',
      'node_modules/paquete/index.js': '// TODO: error interno de la dependencia',
      'dist/bundle.js': '// TODO: artefacto generado',
    });

    const evidence = await new WorkspaceEvidenceScanner().scan(workspace);

    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.location).toBe('src/app.ts:1');
  });

  it('devuelve el mismo resultado en dos recorridos', async () => {
    const workspace = workspaceWith({
      'src/a.ts': '// FIXME: el caso raro',
      'src/b.ts': '// TODO: otro caso',
    });
    const scanner = new WorkspaceEvidenceScanner();

    const first = await scanner.scan(workspace);
    const second = await scanner.scan(workspace);

    expect(first.map((item) => item.location)).toEqual(second.map((item) => item.location));
    expect(first.map((item) => item.location)).toEqual(['src/a.ts:1', 'src/b.ts:1']);
  });

  it('no inventa trabajo cuando el repositorio esta limpio', async () => {
    const workspace = workspaceWith({ 'src/app.ts': 'export const ok = true;' });

    expect(await new WorkspaceEvidenceScanner().scan(workspace)).toHaveLength(0);
  });

  it('no confunde un marcador citado como dato con un pendiente real', async () => {
    const workspace = workspaceWith({
      'test/fixture.ts': "const sample = { texto: '  // TODO: esto es un ejemplo' };",
    });

    expect(await new WorkspaceEvidenceScanner().scan(workspace)).toHaveLength(0);
  });

  it('acota el numero de senales devueltas', async () => {
    const files: Record<string, string> = {};
    for (let index = 0; index < 10; index += 1) files[`src/f${index}.ts`] = '// TODO: pendiente';
    const workspace = workspaceWith(files);

    const evidence = await new WorkspaceEvidenceScanner({ maxEvidence: 3 }).scan(workspace);

    expect(evidence).toHaveLength(3);
  });
});

describe('WorkspaceDiscovery · candidatos con evidencia', () => {
  it('traduce senales a candidatos con criterio de cierre y prioridad baja', async () => {
    const workspace = workspaceWith({ 'src/app.ts': '// TODO: corregir el borde' });

    const candidates = await new WorkspaceDiscovery().discover(
      aMission({ workspace }),
      null,
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.evidenceRefs).toEqual(['src/app.ts:1']);
    expect(candidates[0]?.doneWhen.length).toBeGreaterThan(0);
    expect(candidates[0]?.priority).toBe(0);
    expect(candidates[0]?.source).toBe('observed');
  });

  it('el backlog curado tiene prioridad sobre lo descubierto', async () => {
    const workspace = workspaceWith({ 'src/app.ts': '// TODO: corregir el borde' });

    const candidates = await new WorkspaceDiscovery().discover(
      aMission({ workspace, backlog: [] }),
      null,
    );

    expect(candidates[0]?.priority).toBe(0);
  });
});
