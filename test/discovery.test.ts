import { describe, expect, it, afterEach } from 'vitest';
import { cleanupTempDirs, tempDir } from './support/temp.js';

afterEach(cleanupTempDirs);
import { mkdirSync, writeFileSync } from 'node:fs';


import { join } from 'node:path';
import { WorkspaceEvidenceScanner } from '../src/adapters/discovery.js';
import { WorkspaceDiscovery } from '../src/adapters/candidates.js';
import { aMission } from './support/harness.js';

function workspaceWith(files: Record<string, string>): string {
  const root = tempDir('gcl-ws-');
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

describe('WorkspaceEvidenceScanner · deuda silenciada', () => {
  it('encuentra una comprobacion silenciada', async () => {
    const workspace = workspaceWith({
      'src/parser.ts': ['export function parse() {', '  // @ts-ignore: el tipo no cuadra', '}'].join('\n'),
    });

    const evidence = await new WorkspaceEvidenceScanner().scan(workspace);

    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.kind).toBe('debt-suppression');
    expect(evidence[0]?.location).toBe('src/parser.ts:2');
    expect(evidence[0]?.summary).toBe('@ts-ignore');
    expect(evidence[0]?.objective).toContain('src/parser.ts:2');
    expect(evidence[0]?.doneWhen.length).toBeGreaterThan(0);
  });

  it('encuentra una regla de lint silenciada', async () => {
    const workspace = workspaceWith({
      'src/app.ts': '/* eslint-disable no-console */',
    });

    const evidence = await new WorkspaceEvidenceScanner().scan(workspace);

    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.kind).toBe('debt-suppression');
    expect(evidence[0]?.summary).toBe('eslint-disable');
  });

  it('no confunde una palabra de dato con una supresion', async () => {
    const workspace = workspaceWith({
      'src/app.ts': "const mensaje = 'esto es un @ts-ignore de ejemplo';",
    });

    expect(await new WorkspaceEvidenceScanner().scan(workspace)).toHaveLength(0);
  });
});

describe('WorkspaceEvidenceScanner · drift de la documentacion', () => {
  it('encuentra un enlace a un fichero que no esta', async () => {
    const workspace = workspaceWith({
      'docs/roadmap.md': ['# Roadmap', '', 'El detalle esta en [la triaje](triage.md).'].join('\n'),
    });

    const evidence = await new WorkspaceEvidenceScanner().scan(workspace);

    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.kind).toBe('drift');
    expect(evidence[0]?.location).toBe('docs/roadmap.md:3');
    expect(evidence[0]?.summary).toContain('triage.md');
    expect(evidence[0]?.doneWhen.length).toBeGreaterThan(0);
  });

  it('encuentra un enlace a un ancla que no existe', async () => {
    const workspace = workspaceWith({
      'docs/roadmap.md': ['# Roadmap', '', 'Mira el [detalle](otra.md#seccion).'].join('\n'),
      'docs/otra.md': ['# Otra cosa', '', 'Nada que ver.'].join('\n'),
    });

    const evidence = await new WorkspaceEvidenceScanner().scan(workspace);

    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.kind).toBe('drift');
    expect(evidence[0]?.location).toBe('docs/roadmap.md:3');
    expect(evidence[0]?.summary).toContain('seccion');
  });

  it('no inventa drift cuando los enlaces existen', async () => {
    const workspace = workspaceWith({
      'docs/roadmap.md': [
        '# Roadmap',
        '',
        'El detalle esta en [la triaje](triage.md) y en [el codigo](../src/app.ts).',
      ].join('\n'),
      'docs/triage.md': '# Triaje\n',
      'src/app.ts': 'export const ok = true;\n',
    });

    expect(await new WorkspaceEvidenceScanner().scan(workspace)).toHaveLength(0);
  });

  it('no toma un ejemplo dentro de un bloque de codigo por una referencia', async () => {
    const workspace = workspaceWith({
      'docs/roadmap.md': [
        '# Roadmap',
        '',
        'Un enlace se escribe asi:',
        '',
        '```text',
        '[la triaje](triage.md)',
        '```',
        '',
        'Y en linea asi: `[la triaje](triage.md)`.',
      ].join('\n'),
    });

    expect(await new WorkspaceEvidenceScanner().scan(workspace)).toHaveLength(0);
  });

  it('no mira los enlaces a otros sitios de internet', async () => {
    const workspace = workspaceWith({
      'docs/roadmap.md': 'Mira el [manual](https://example.com/manual.md) y el [correo](mailto:quien@example.com).',
    });

    expect(await new WorkspaceEvidenceScanner().scan(workspace)).toHaveLength(0);
  });

  it('el drift llega a los candidatos con evidencia y criterio de cierre', async () => {
    const workspace = workspaceWith({
      'docs/roadmap.md': 'El detalle esta en [la triaje](triage.md).',
    });

    const candidates = await new WorkspaceDiscovery().discover(aMission({ workspace }), null);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.evidenceRefs).toEqual(['docs/roadmap.md:1']);
    expect(candidates[0]?.doneWhen.length).toBeGreaterThan(0);
    expect(candidates[0]?.priority).toBe(0);
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
