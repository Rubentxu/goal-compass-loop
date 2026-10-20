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
 * preguntas responder, que accion minima hacer, como se sabe que se ha
 * terminado y a donde se puede ir desde ahi.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL_DIR = resolve(fileURLToPath(new URL('../skill/goal-compass', import.meta.url)));
const GRAPH_DIR = join(SKILL_DIR, 'graph');
const NODES_DIR = join(GRAPH_DIR, 'nodes');

/** Secciones que todo nodo tiene que tener, en este orden. */
const REQUIRED_SECTIONS = [
  '## Cuándo entrar',
  '## Preguntas',
  '## Acción mínima',
  '## Criterio de salida',
  '## Enlaces',
];

/** Relaciones admitidas entre nodos. */
const VALID_RELATIONS = new Set([
  'next',
  'recover',
  'complete',
  'escalate',
  'inspect',
  'discover',
  'await',
]);

/** Enlace de nodo: destino, relacion, condicion y evidencia. */
const LINK = /^- \[([a-z-]+)\]\(([^)]+\.md)\) — rel=([a-z]+); si=([^;]+); evidencia=(.+)$/;

interface GraphLink {
  label: string;
  target: string;
  relation: string;
  condition: string;
  evidence: string;
  raw: string;
}

function read(file: string): string {
  return readFileSync(file, 'utf8');
}

function nodeFiles(): string[] {
  return readdirSync(NODES_DIR)
    .filter((name) => name.endsWith('.md'))
    .sort();
}

/** Nombre del nodo al que apunta un enlace, sea cual sea su ruta. */
function nodeStem(target: string): string {
  return basename(target).replace(/\.md$/, '');
}

function linksOf(body: string): GraphLink[] {
  const links: GraphLink[] = [];
  for (const line of body.split('\n')) {
    if (!line.startsWith('- [')) continue;
    const match = LINK.exec(line);
    if (!match) continue;
    const [, label, target, relation, condition, evidence] = match;
    links.push({
      label: label!,
      target: target!,
      relation: relation!,
      condition: condition!,
      evidence: evidence!,
      raw: line,
    });
  }
  return links;
}

describe('el grafo de la skill que se entrega', () => {
  it('tiene la skill y su indice', () => {
    expect(existsSync(join(SKILL_DIR, 'SKILL.md'))).toBe(true);
    expect(existsSync(join(GRAPH_DIR, 'index.md'))).toBe(true);
    expect(nodeFiles().length).toBeGreaterThanOrEqual(8);
  });

  it('la skill se presenta como la skill de goal-compass', () => {
    const skill = read(join(SKILL_DIR, 'SKILL.md'));
    expect(skill.startsWith('---\nname: goal-compass\n')).toBe(true);
  });

  it('cada nodo tiene la forma que el agente necesita', () => {
    for (const name of nodeFiles()) {
      const body = read(join(NODES_DIR, name));
      const stem = name.replace(/\.md$/, '');

      expect(body.startsWith(`# ${stem} ·`), `${name}: la identidad no coincide`).toBe(true);
      for (const section of REQUIRED_SECTIONS) {
        expect(body, `${name}: falta ${section}`).toContain(section);
      }

      const questions = body.split('## Preguntas')[1]?.split('## Acción mínima')[0] ?? '';
      const count = (questions.match(/^\d+\. /gm) ?? []).length;
      expect(count, `${name}: ${count} preguntas, se esperan de 1 a 3`).toBeGreaterThanOrEqual(1);
      expect(count, `${name}: ${count} preguntas, se esperan de 1 a 3`).toBeLessThanOrEqual(3);
    }
  });

  it('los enlaces apuntan a nodos que existen y dicen como se usan', () => {
    for (const name of [...nodeFiles(), 'index.md']) {
      const path = name === 'index.md' ? join(GRAPH_DIR, name) : join(NODES_DIR, name);
      const links = linksOf(read(path));

      expect(links.length, `${name}: sin enlaces`).toBeGreaterThan(0);
      for (const link of links) {
        const destination = resolve(dirname(path), link.target);
        expect(link.label, `${name}: el enlace no nombra a su destino`).toBe(nodeStem(link.target));
        expect(VALID_RELATIONS.has(link.relation), `${name}: relación desconocida ${link.relation}`).toBe(true);
        expect(link.condition.trim(), `${name}: condición vacía`).not.toBe('');
        expect(link.evidence.trim(), `${name}: evidencia vacía`).not.toBe('');
        expect(existsSync(destination), `${name}: enlace roto ${link.target}`).toBe(true);
        expect(destination.startsWith(`${GRAPH_DIR}${sep}`), `${name}: el enlace sale del grafo`).toBe(true);
      }
    }
  });

  it('se puede llegar a todos los nodos y salir de todos ellos', () => {
    const index = read(join(GRAPH_DIR, 'index.md'));
    const outgoing = new Map<string, string[]>();

    outgoing.set('index', linksOf(index).map((link) => nodeStem(link.target)));
    for (const name of nodeFiles()) {
      const stem = name.replace(/\.md$/, '');
      outgoing.set(stem, linksOf(read(join(NODES_DIR, name))).map((link) => nodeStem(link.target)));
    }

    // Todo nodo tiene que ser alcanzable desde el indice.
    const reached = new Set<string>(['index']);
    const pending = ['index'];
    while (pending.length > 0) {
      const current = pending.pop()!;
      for (const next of outgoing.get(current) ?? []) {
        if (!reached.has(next)) {
          reached.add(next);
          pending.push(next);
        }
      }
    }
    for (const stem of outgoing.keys()) {
      expect(reached.has(stem), `${stem}: no se llega desde el indice`).toBe(true);
    }

    // Y todo nodo tiene que poder terminar: hay un camino hasta un cierre.
    const TERMINALS = new Set(['finish', 'stop']);
    for (const stem of outgoing.keys()) {
      const visited = new Set<string>();
      const pending = [stem];
      let terminates = false;
      while (pending.length > 0) {
        const current = pending.pop()!;
        if (visited.has(current)) continue;
        visited.add(current);
        if (current !== stem && TERMINALS.has(current)) {
          terminates = true;
          break;
        }
        pending.push(...(outgoing.get(current) ?? []));
      }
      expect(terminates, `${stem}: no hay forma de terminar`).toBe(true);
    }
  });

  it('el indice ofrece una salida por nodo', () => {
    const index = read(join(GRAPH_DIR, 'index.md'));
    const linked = new Set(linksOf(index).map((link) => nodeStem(link.target)));
    for (const name of nodeFiles()) {
      const stem = name.replace(/\.md$/, '');
      expect(linked.has(stem), `el indice no ofrece ${stem}`).toBe(true);
    }
  });
});
