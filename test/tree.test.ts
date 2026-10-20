/**
 * El arbol de decision: el lector de YAML, la cabecera de cada nodo y el arbol
 * que se monta con ellos.
 *
 * El arbol es la parte que el agente lee para decidir. Si se rompe un enlace,
 * si un nodo se queda sin salida o si la cabecera no se entiende, el agente se
 * pierde en silencio. Estas comprobaciones son su contrato.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { cleanupTempDirs, tempDir } from './support/temp.js';

afterEach(cleanupTempDirs);
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';


import { join } from 'node:path';
import { parseFrontmatter, parseYaml, YamlError } from '../src/adapters/yaml.js';
import { loadTree, TreeError, validateTree } from '../src/adapters/tree.js';
import { ensureWorkdir, treeDirFor } from '../src/adapters/workdir.js';


/** Escribe un nodo con cabecera y cuerpo, y devuelve su directorio. */
function treeOf(nodes: Record<string, string>): string {
  const dir = tempDir('gcl-arbol-');
  for (const [name, content] of Object.entries(nodes)) {
    const path = join(dir, `${name}.md`);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content, 'utf8');
  }
  return dir;
}

/**
 * Un nodo de prueba.
 *
 * Enlaza con `destino`, que por defecto es el propio nodo: asi el arbol de
 * prueba es un ciclo y solo hay que cambiar el destino cuando importa.
 */
const NODE = (id: string, extra = '', destino = id): string =>
  `---\nid: ${id}\nrole: agent\n${extra}links:\n  - to: ${destino}\n    rel: next\n    when: sigue\n    evidence: prueba\n---\n\n# ${id} · Nodo\n\n## Cuándo entrar\n\nSiempre.\n\n## Preguntas\n\n1. ¿Qué?\n\n## Acción mínima\n\nHacer.\n\n## Criterio de salida\n\nHecho.\n`;

describe('el lector de yaml', () => {
  it('lee mapas, listas y escalares', () => {
    const value = parseYaml(
      [
        'version: 1',
        'entrada: index',
        'activo: true',
        'vacio: null',
        'lista:',
        '  - uno',
        '  - dos',
        'mapa:',
        '  clave: valor',
        '  numero: 42',
      ].join('\n'),
    );

    expect(value).toEqual({
      version: 1,
      entrada: 'index',
      activo: true,
      vacio: null,
      lista: ['uno', 'dos'],
      mapa: { clave: 'valor', numero: 42 },
    });
  });

  it('lee una lista de mapas', () => {
    const value = parseYaml(
      ['nodos:', '  - id: uno', '    rol: agent', '  - id: dos', '    rol: supervisor'].join('\n'),
    );
    expect(value).toEqual({
      nodos: [
        { id: 'uno', rol: 'agent' },
        { id: 'dos', rol: 'supervisor' },
      ],
    });
  });

  it('ignora los comentarios pero no el # de un texto', () => {
    const value = parseYaml(
      ['# un comentario', 'fichero: docs/triage.md#terraform-edges', 'otro: valor # si esto'].join(
        '\n',
      ),
    );
    expect(value).toEqual({ fichero: 'docs/triage.md#terraform-edges', otro: 'valor' });
  });

  it('lee texto de bloque', () => {
    const value = parseYaml(['texto: |', '  primera', '  segunda'].join('\n'));
    expect(value).toEqual({ texto: 'primera\nsegunda\n' });
  });

  it('dice en que linea se rompio', () => {
    expect(() => parseYaml(['bien: 1', 'esto no es una entrada'].join('\n'))).toThrow(YamlError);
    try {
      parseYaml(['bien: 1', 'esto no es una entrada'].join('\n'));
    } catch (err) {
      expect((err as YamlError).line).toBe(2);
    }
  });
});

describe('la cabecera yaml', () => {
  it('separa los datos del cuerpo', () => {
    const { data, body } = parseFrontmatter('---\nid: uno\n---\n\n# uno · Nodo\n');
    expect(data).toEqual({ id: 'uno' });
    expect(body).toBe('# uno · Nodo\n');
  });

  it('un fichero sin cabecera es todo cuerpo', () => {
    const { data, body } = parseFrontmatter('# uno · Nodo\n');
    expect(data).toBeNull();
    expect(body).toBe('# uno · Nodo\n');
  });
});

describe('el arbol de decision', () => {
  it('monta el arbol con sus nodos y su entrada', () => {
    const dir = treeOf({
      index: NODE('index', 'entry: true\n', 'siguiente'),
      siguiente: NODE('siguiente', '', 'index'),
    });

    const tree = loadTree(dir);
    expect(tree.entry).toBe('index');
    expect(tree.nodes.size).toBe(2);
    expect(tree.nodes.get('index')?.links[0]?.to).toBe('siguiente');
    expect(tree.nodes.get('index')?.title).toBe('Nodo');
  });

  it('rechaza un nodo sin cabecera', () => {
    const dir = treeOf({ index: '# index · Nodo\n' });
    expect(() => loadTree(dir)).toThrow(TreeError);
  });

  it('rechaza un enlace sin condicion', () => {
    const dir = treeOf({
      index: `---\nid: index\nrole: agent\nentry: true\nlinks:\n  - to: otro\n    rel: next\n---\n\n# index · Nodo\n`,
      otro: NODE('otro').replace('    when: sigue\n', ''),
    });
    expect(() => loadTree(dir)).toThrow(/when/);
  });

  it('rechaza una relacion que no existe', () => {
    const dir = treeOf({
      index: `---\nid: index\nrole: agent\nentry: true\nlinks:\n  - to: otro\n    rel: inventado\n    when: sigue\n    evidence: prueba\n---\n\n# index · Nodo\n`,
      otro: NODE('otro', '', 'index'),
    });
    expect(() => loadTree(dir)).toThrow(/relacion/);
  });

  it('avisa de un enlace que no apunta a nadie', () => {
    const dir = treeOf({
      index: `---\nid: index\nrole: agent\nentry: true\nlinks:\n  - to: fantasma\n    rel: next\n    when: sigue\n    evidence: prueba\n---\n\n# index · Nodo\n`,
    });
    const problems = validateTree(loadTree(dir));
    expect(problems.join(' ')).toContain('fantasma');
  });

  it('avisa de un nodo al que no se llega', () => {
    const dir = treeOf({
      index: `---\nid: index\nrole: agent\nentry: true\nlinks:\n  - to: index\n    rel: next\n    when: sigue\n    evidence: prueba\n---\n\n# index · Nodo\n`,
      suelto: NODE('suelto').replace('links:\n  - to: siguiente-siguiente', 'links:\n  - to: index'),
    });
    const problems = validateTree(loadTree(dir));
    expect(problems.join(' ')).toContain('suelto');
  });

  it('avisa de un nodo sin salida', () => {
    const dir = treeOf({
      index: `---\nid: index\nrole: agent\nentry: true\nlinks:\n  - to: final\n    rel: next\n    when: sigue\n    evidence: prueba\n---\n\n# index · Nodo\n`,
      final: '---\nid: final\nrole: agent\nlinks: []\n---\n\n# final · Nodo\n',
    });
    const problems = validateTree(loadTree(dir));
    expect(problems.join(' ')).toContain('no tiene salida');
  });

  it('avisa si un nodo de control se entra por una relacion que no es', () => {
    const dir = treeOf({
      index: `---\nid: index\nrole: agent\nentry: true\nlinks:\n  - to: control\n    rel: next\n    when: sigue\n    evidence: prueba\n---\n\n# index · Nodo\n`,
      control: NODE('control').replace('role: agent', 'role: supervisor'),
    });
    const problems = validateTree(loadTree(dir));
    expect(problems.join(' ')).toContain('discover o await');
  });

  it('rechaza un arbol sin entrada', () => {
    const dir = treeOf({ index: NODE('index') });
    expect(() => loadTree(dir)).toThrow(/entrada/);
  });
});

describe('el directorio de trabajo', () => {
  it('se crea y queda ignorado por git', () => {
    const dir = tempDir('gcl-arbol-');
    try {
      const state = ensureWorkdir(dir);

      expect(state.created).toBe(true);
      expect(state.path).toBe(join(dir, '.goal-compass'));
      expect(existsSync(state.path)).toBe(true);
      expect(state.gitignoreAdded).toBe(true);
      expect(state.ignored).toBe(true);
      expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toContain('.goal-compass/');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('no duplica la entrada del .gitignore', () => {
    const dir = tempDir('gcl-arbol-');
    try {
      ensureWorkdir(dir);
      const state = ensureWorkdir(dir);

      expect(state.created).toBe(false);
      expect(state.gitignoreAdded).toBe(false);
      expect(state.ignored).toBe(true);
      expect(readFileSync(join(dir, '.gitignore'), 'utf8').match(/\.goal-compass/g)).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('el arbol propio del proyecto manda sobre el de la skill', () => {
    const dir = tempDir('gcl-arbol-');
    try {
      const fallback = tempDir('gcl-arbol-');
      writeFileSync(join(fallback, 'index.md'), '# fallback\n', 'utf8');

      expect(treeDirFor(dir, fallback)).toEqual({ dir: fallback, source: 'skill' });

      ensureWorkdir(dir);
      writeFileSync(join(dir, '.goal-compass', 'index.md'), '# propio\n', 'utf8');

      expect(treeDirFor(dir, fallback)).toEqual({
        dir: join(dir, '.goal-compass'),
        source: 'proyecto',
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
