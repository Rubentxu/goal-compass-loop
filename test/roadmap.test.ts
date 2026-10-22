/**
 * El roadmap manda sobre lo que se ofrece como trabajo.
 *
 * Una propuesta que apunta a una sección cerrada del roadmap ya no es trabajo
 * futuro: es trabajo que ya se hizo. Sin esto, la cadena vuelve a ofrecer lo
 * mismo una y otra vez.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanupTempDirs, tempDir } from './support/temp.js';
import { closeRoadmapSection, evidenceSectionClosed, roadmapSection } from '../src/adapters/roadmap.js';

afterEach(cleanupTempDirs);

const ROADMAP = [
  '<a id="p1"></a>',
  '',
  '## 1 · Algo abierto',
  '',
  '**Prioridad:** alta',
  '',
  '---',
  '',
  '<a id="p2"></a>',
  '',
  '## 2 · Algo cerrado',
  '',
  '**Prioridad:** alta · **Estado:** cerrado (ya esta hecho)',
  '',
  '---',
  '',
].join('\n');

function workspaceConRoadmap(contenido = ROADMAP): string {
  const workspace = tempDir('gcl-roadmap-');
  mkdirSync(join(workspace, 'docs'), { recursive: true });
  writeFileSync(join(workspace, 'docs', 'roadmap.md'), contenido, 'utf8');
  return workspace;
}

describe('el roadmap dice que secciones siguen abiertas', () => {
  it('una seccion sin marcar esta abierta', () => {
    const workspace = workspaceConRoadmap();

    const seccion = roadmapSection(join(workspace, 'docs', 'roadmap.md'), 'p1');

    expect(seccion?.status).toBe('abierto');
    expect(seccion?.title).toBe('1 · Algo abierto');
  });

  it('una seccion marcada como cerrada esta cerrada', () => {
    const workspace = workspaceConRoadmap();

    const seccion = roadmapSection(join(workspace, 'docs', 'roadmap.md'), 'p2');

    expect(seccion?.status).toBe('cerrado');
  });

  it('un ancla que no existe no inventa una seccion', () => {
    const workspace = workspaceConRoadmap();

    expect(roadmapSection(join(workspace, 'docs', 'roadmap.md'), 'p99')).toBeNull();
    expect(roadmapSection(join(workspace, 'docs', 'no-existe.md'), 'p1')).toBeNull();
  });

  it('la evidencia que apunta a una seccion cerrada se detecta', () => {
    const workspace = workspaceConRoadmap();

    expect(evidenceSectionClosed(workspace, ['docs/roadmap.md#p2'])).toBe(true);
    expect(evidenceSectionClosed(workspace, ['docs/roadmap.md#p1'])).toBe(false);
  });

  it('una evidencia sin ancla no dice nada sobre el estado', () => {
    const workspace = workspaceConRoadmap();

    expect(evidenceSectionClosed(workspace, ['docs/roadmap.md'])).toBe(false);
    expect(evidenceSectionClosed(workspace, [])).toBe(false);
  });
});

describe('una seccion del roadmap se puede cerrar', () => {
  it('al cerrarla queda marcada como cerrada, con el motivo', () => {
    const workspace = workspaceConRoadmap();
    const path = join(workspace, 'docs', 'roadmap.md');

    const resultado = closeRoadmapSection(path, 'p1', 'ya esta hecho');

    expect(resultado.alreadyClosed).toBe(false);
    const seccion = roadmapSection(path, 'p1');
    expect(seccion?.status).toBe('cerrado');
    expect(seccion?.text).toContain('ya esta hecho');
  });

  it('al cerrarla deja de ofrecer trabajo', () => {
    const workspace = workspaceConRoadmap();
    const path = join(workspace, 'docs', 'roadmap.md');

    expect(evidenceSectionClosed(workspace, ['docs/roadmap.md#p1'])).toBe(false);
    closeRoadmapSection(path, 'p1', 'ya esta hecho');

    expect(evidenceSectionClosed(workspace, ['docs/roadmap.md#p1'])).toBe(true);
  });

  it('no reescribe una seccion que ya estaba cerrada', () => {
    const workspace = workspaceConRoadmap();
    const path = join(workspace, 'docs', 'roadmap.md');
    const antes = readFileSync(path, 'utf8');

    const resultado = closeRoadmapSection(path, 'p2', 'otra vez');

    expect(resultado.alreadyClosed).toBe(true);
    expect(readFileSync(path, 'utf8')).toBe(antes);
  });

  it('no toca el resto del roadmap', () => {
    const workspace = workspaceConRoadmap();
    const path = join(workspace, 'docs', 'roadmap.md');

    closeRoadmapSection(path, 'p1', 'ya esta hecho');

    const texto = readFileSync(path, 'utf8');
    expect(texto).toContain('## 2 · Algo cerrado');
    expect(texto).toContain('**Estado:** cerrado (ya esta hecho)');
  });

  it('un ancla que no existe no se cierra en silencio', () => {
    const workspace = workspaceConRoadmap();
    const path = join(workspace, 'docs', 'roadmap.md');

    expect(() => closeRoadmapSection(path, 'p99', 'nada')).toThrow();
  });
});
