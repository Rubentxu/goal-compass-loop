/**
 * Un proyecto puede partir del árbol sin escribir las trece fichas a mano.
 *
 * Se copia el árbol de la skill al directorio del proyecto, y desde ese
 * momento el proyecto manda sobre la skill. Lo que el proyecto ya tenía
 * escrito no se toca: es suyo, y se hizo a propósito.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanupTempDirs, tempDir } from './support/temp.js';
import { copyTreeFrom, treeDirFor } from '../src/adapters/workdir.js';
import { loadTree, validateTree } from '../src/adapters/tree.js';

afterEach(cleanupTempDirs);

const raiz = resolve(fileURLToPath(new URL('..', import.meta.url)));
const arbolDeLaSkill = join(raiz, 'skill', 'goal-compass', 'graph');

describe('el proyecto puede partir del arbol de la skill', () => {
  it('copia el arbol entero, y el copia valida sin problemas', () => {
    const destino = join(tempDir('gcl-arbol-nuevo-'), '.goal-compass');
    mkdirSync(destino, { recursive: true });

    const copia = copyTreeFrom(arbolDeLaSkill, destino);

    expect(copia.copied.length).toBeGreaterThan(10);
    expect(copia.kept).toHaveLength(0);

    const tree = loadTree(destino);
    expect(validateTree(tree)).toEqual([]);
  });

  it('no pisa un nodo que el proyecto ya tiene escrito', () => {
    const destino = join(tempDir('gcl-arbol-mio-'), '.goal-compass');
    mkdirSync(destino, { recursive: true });
    const mio = join(destino, 'index.md');
    writeFileSync(mio, '---\nid: index\n---\n\n# lo mio\n', 'utf8');

    const copia = copyTreeFrom(arbolDeLaSkill, destino);

    expect(copia.kept).toContain('index.md');
    expect(readFileSync(mio, 'utf8')).toContain('lo mio');
  });

  it('el proyecto manda sobre la skill desde que tiene arbol', () => {
    const workspace = tempDir('gcl-arbol-manda-');
    const destino = join(workspace, '.goal-compass');
    mkdirSync(destino, { recursive: true });

    const antes = treeDirFor(workspace, arbolDeLaSkill);
    expect(antes.source).toBe('skill');

    copyTreeFrom(arbolDeLaSkill, destino);

    const despues = treeDirFor(workspace, arbolDeLaSkill);
    expect(despues.source).toBe('proyecto');
    expect(despues.dir).toBe(destino);
  });
});
