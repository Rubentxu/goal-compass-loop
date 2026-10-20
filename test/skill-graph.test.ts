/**
 * El grafo de la skill que se entrega.
 *
 * La skill es lo que lee el agente cuando encadena un objetivo: si un enlace
 * se rompe, si un nodo pierde su forma o si un nodo queda sin salida, el
 * agente se pierde sin que nadie se entere. Estas comprobaciones son el
 * contrato de esa forma, y se ejecutan contra el fichero que se instala, no
 * contra una copia congelada.
 *
 * El grafo es un mapa de decisiones: cada nodo dice cuando se entra, que
 * preguntas responder, que accion minima hacer y como se sabe que se ha
 * terminado. La topologia —a donde va cada nodo y con que condicion— vive en
 * la cabecera YAML de cada fichero, y se comprueba con el mismo cargador que
 * usa el producto.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTree, unreachableNodes, validateTree } from '../src/adapters/tree.js';

const SKILL_DIR = resolve(fileURLToPath(new URL('../skill/goal-compass', import.meta.url)));
const GRAPH_DIR = join(SKILL_DIR, 'graph');

/** Secciones que todo nodo tiene que tener, en este orden. */
const REQUIRED_SECTIONS = [
  '## Cuándo entrar',
  '## Preguntas',
  '## Acción mínima',
  '## Criterio de salida',
];

/** Nodos que cierran un objetivo. */
const TERMINALS = new Set(['finish', 'stop']);

const tree = loadTree(GRAPH_DIR);

describe('el grafo de la skill que se entrega', () => {
  it('tiene la skill y su indice', () => {
    expect(existsSync(join(SKILL_DIR, 'SKILL.md'))).toBe(true);
    expect(existsSync(join(GRAPH_DIR, 'index.md'))).toBe(true);
    expect(tree.nodes.size).toBeGreaterThanOrEqual(8);
  });

  it('la skill se presenta como la skill de goal-compass', () => {
    const skill = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8');
    expect(skill.startsWith('---\nname: goal-compass\n')).toBe(true);
  });

  it('el arbol carga y no tiene problemas', () => {
    expect(validateTree(tree)).toEqual([]);
  });

  it('cada nodo de fase tiene la forma que el agente necesita', () => {
    for (const node of tree.nodes.values()) {
      const body = node.prompt;

      expect(body.startsWith('# '), `${node.id}: el prompt no empieza por su titulo`).toBe(true);
      if (node.id === tree.entry) continue;

      for (const section of REQUIRED_SECTIONS) {
        expect(body, `${node.id}: falta ${section}`).toContain(section);
      }

      const questions = body.split('## Preguntas')[1]?.split('## Acción mínima')[0] ?? '';
      const count = (questions.match(/^\d+\. /gm) ?? []).length;
      expect(count, `${node.id}: ${count} preguntas, se esperan de 1 a 3`).toBeGreaterThanOrEqual(1);
      expect(count, `${node.id}: ${count} preguntas, se esperan de 1 a 3`).toBeLessThanOrEqual(3);
    }
  });

  it('los enlaces dicen como se usan', () => {
    for (const node of tree.nodes.values()) {
      expect(node.links.length, `${node.id}: sin enlaces`).toBeGreaterThan(0);
      for (const link of node.links) {
        expect(link.when.trim(), `${node.id}: condicion vacia`).not.toBe('');
        expect(link.evidence.trim(), `${node.id}: evidencia vacia`).not.toBe('');
      }
    }
  });

  it('se puede llegar a todos los nodos y salir de todos ellos', () => {
    expect(unreachableNodes(tree)).toEqual([]);

    for (const node of tree.nodes.values()) {
      const visited = new Set<string>();
      const pending = [node.id];
      let terminates = false;
      while (pending.length > 0) {
        const current = pending.pop()!;
        if (visited.has(current)) continue;
        visited.add(current);
        if (current !== node.id && TERMINALS.has(current)) {
          terminates = true;
          break;
        }
        const next = tree.nodes.get(current);
        pending.push(...(next?.links.map((link) => link.to) ?? []));
      }
      expect(terminates, `${node.id}: no hay forma de terminar`).toBe(true);
    }
  });

  it('el indice ofrece una salida por nodo', () => {
    const entry = tree.nodes.get(tree.entry);
    const linked = new Set(entry?.links.map((link) => link.to) ?? []);
    for (const id of tree.nodes.keys()) {
      if (id === tree.entry) continue;
      expect(linked.has(id), `el indice no ofrece ${id}`).toBe(true);
    }
  });

  it('los nodos de control son del supervisor y se entran por discover o await', () => {
    const control = [...tree.nodes.values()].filter((node) => node.role === 'supervisor');
    expect(control.length).toBeGreaterThan(0);

    for (const node of tree.nodes.values()) {
      for (const link of node.links) {
        const target = tree.nodes.get(link.to);
        if (target?.role !== 'supervisor') continue;
        expect(
          link.rel === 'discover' || link.rel === 'await',
          `${node.id} entra en ${link.to} con rel=${link.rel}`,
        ).toBe(true);
      }
    }
  });
});
