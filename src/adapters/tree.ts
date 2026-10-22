/**
 * El arbol de decision: nodos con prompt en markdown y metadatos en la cabecera.
 *
 * Cada nodo es un fichero de markdown que empieza con una cabecera YAML. La
 * cabecera dice **quien** puede ejecutar el nodo y **a donde** puede ir desde
 * ahi; el cuerpo es el prompt que lee el agente. La topologia es, por tanto,
 * dato: se puede validar, se puede extender y un proyecto puede sustituirla.
 *
 * El arbol se carga de un directorio: todos los markdown que haya en el, leidos
 * en cascada. El nodo de entrada es el que lo dice su cabecera.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parseFrontmatter, type YamlValue } from './yaml.js';

/** Quién puede ejecutar un nodo. */
export type NodeRole = 'agent' | 'supervisor';

/** Las relaciones que puede tener un enlace. */
export const TREE_RELATIONS = [
  'next',
  'recover',
  'complete',
  'escalate',
  'discover',
  'await',
] as const;

/** Una relacion admitida entre nodos. */
export type TreeRelation = (typeof TREE_RELATIONS)[number];

/** Un enlace: a donde se va, con que relacion, cuando y con que evidencia. */
export interface TreeLink {
  to: string;
  rel: TreeRelation;
  when: string;
  evidence: string;
}

/** Un nodo del arbol. */
export interface TreeNode {
  id: string;
  title: string;
  role: NodeRole;
  /** El prompt del nodo: el cuerpo del markdown. */
  prompt: string;
  /** El fichero de donde salio. */
  path: string;
  links: TreeLink[];
}

/** Un arbol de decision completo. */
export interface DecisionTree {
  version: number;
  entry: string;
  nodes: Map<string, TreeNode>;
  /** El directorio del que se cargo. */
  dir: string;
}

/** Error de un arbol mal formado. */
export class TreeError extends Error {
  constructor(message: string) {
    super(`arbol: ${message}`);
    this.name = 'TreeError';
  }
}

/**
 * Carga el arbol de un directorio.
 *
 * Lee todos los markdown que encuentra, en cascada, y monta el arbol con sus
 * nodos. Los problemas de forma (una cabecera que no es un mapa, un enlace sin
 * condicion) se rechazan aqui; los de sentido (un enlace que no apunta a
 * nadie, un nodo inalcanzable) los comprueba `validateTree`.
 */
export function loadTree(dir: string): DecisionTree {
  const root = resolve(dir);
  const files = markdownFiles(root);

  if (files.length === 0) {
    throw new TreeError(`no hay ningun markdown en ${root}`);
  }

  const nodes = new Map<string, TreeNode>();
  let entry: string | undefined;
  let version = 1;

  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const { data, body } = parseFrontmatter(text);

    if (data === null) {
      throw new TreeError(`${relative(root, file)} no tiene cabecera`);
    }
    if (!isMap(data)) {
      throw new TreeError(`la cabecera de ${relative(root, file)} no es un mapa`);
    }

    const id = readString(data, 'id', relative(root, file));
    if (nodes.has(id)) {
      throw new TreeError(`el nodo "${id}" esta definido dos veces`);
    }

    const title = titleOf(body) ?? id;
    const role = readRole(data, id);
    const links = readLinks(data, id);

    nodes.set(id, { id, title, role, prompt: body, path: file, links });

    if (data.entry === true) {
      if (entry !== undefined) {
        throw new TreeError(`hay mas de un nodo de entrada: "${entry}" y "${id}"`);
      }
      entry = id;
    }
    if (typeof data.version === 'number') version = data.version;
  }

  if (entry === undefined) {
    throw new TreeError('ningun nodo declara la entrada del arbol');
  }

  return { version, entry, nodes, dir: root };
}

/**
 * Comprueba que el arbol tiene sentido.
 *
 * Devuelve la lista de problemas encontrados, vacia cuando todo esta bien.
 * Cada problema es una frase que se puede leer y arreglar.
 */
export function validateTree(tree: DecisionTree): string[] {
  const problems: string[] = [];

  if (!tree.nodes.has(tree.entry)) {
    problems.push(`la entrada "${tree.entry}" no es un nodo del arbol`);
  }

  for (const node of tree.nodes.values()) {
    if (node.links.length === 0) {
      problems.push(`el nodo "${node.id}" no tiene salida: el agente se queda ahi`);
    }

    for (const link of node.links) {
      const target = tree.nodes.get(link.to);
      if (!target) {
        problems.push(
          `el nodo "${node.id}" apunta a "${link.to}", que no existe en el arbol`,
        );
        continue;
      }

      // Un nodo de control se entra solo por `discover` o `await`: es el
      // supervisor quien toma el control, no el agente.
      if (target.role === 'supervisor' && link.rel !== 'discover' && link.rel !== 'await') {
        problems.push(
          `el nodo "${node.id}" entra en "${link.to}" con rel=${link.rel}, ` +
            'y ese nodo es de control: un nodo de control solo se entra por discover o await',
        );
      }
    }
  }

  for (const unreachable of unreachableNodes(tree)) {
    problems.push(`el nodo "${unreachable}" no se alcanza desde la entrada "${tree.entry}"`);
  }

  return problems;
}

/** Los nodos a los que no se llega siguiendo enlaces desde la entrada. */
export function unreachableNodes(tree: DecisionTree): string[] {
  const seen = new Set<string>();
  const pending = [tree.entry];

  while (pending.length > 0) {
    const current = pending.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    const node = tree.nodes.get(current);
    if (!node) continue;
    for (const link of node.links) pending.push(link.to);
  }

  return [...tree.nodes.keys()].filter((id) => !seen.has(id));
}

/** El nodo de entrada con su prompt. */
export function entryNode(tree: DecisionTree): TreeNode {
  const node = tree.nodes.get(tree.entry);
  if (!node) throw new TreeError(`la entrada "${tree.entry}" no existe`);
  return node;
}

/** Los markdown de un directorio, en cascada y ordenados. */
export function markdownFiles(dir: string): string[] {
  const found: string[] = [];

  const walk = (current: string): void => {
    for (const name of readdirSync(current).sort()) {
      const path = join(current, name);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (name.endsWith('.md')) found.push(path);
    }
  };

  walk(dir);
  return found;
}

/** El titulo del prompt: lo que va tras el guion del primer encabezado. */
function titleOf(body: string): string | undefined {
  const heading = body.split('\n').find((line) => line.startsWith('# '));
  if (!heading) return undefined;
  const text = heading.slice(2).trim();
  const separator = text.indexOf('·');
  return separator === -1 ? text : text.slice(separator + 1).trim();
}

function isMap(value: YamlValue): value is { [key: string]: YamlValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(data: { [key: string]: YamlValue }, key: string, where: string): string {
  const value = data[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TreeError(`${where} no declara "${key}"`);
  }
  return value.trim();
}

function readRole(data: { [key: string]: YamlValue }, id: string): NodeRole {
  const value = data.role;
  if (value !== 'agent' && value !== 'supervisor') {
    throw new TreeError(`el nodo "${id}" no declara un role valido (agent o supervisor)`);
  }
  return value;
}

function readLinks(data: { [key: string]: YamlValue }, id: string): TreeLink[] {
  const value = data.links;
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new TreeError(`los enlaces del nodo "${id}" no son una lista`);
  }

  return value.map((entry, index) => {
    if (!isMap(entry)) {
      throw new TreeError(`el enlace ${index + 1} del nodo "${id}" no es un mapa`);
    }
    const to = readString(entry, 'to', `el enlace ${index + 1} del nodo "${id}"`);
    const rel = entry.rel;
    if (typeof rel !== 'string' || !TREE_RELATIONS.includes(rel as TreeRelation)) {
      throw new TreeError(
        `el enlace ${index + 1} del nodo "${id}" no declara una relacion valida ` +
          `(${TREE_RELATIONS.join(', ')})`,
      );
    }
    const when = readString(entry, 'when', `el enlace ${index + 1} del nodo "${id}"`);
    const evidence = readString(
      entry,
      'evidence',
      `el enlace ${index + 1} del nodo "${id}"`,
    );
    return { to, rel: rel as TreeRelation, when, evidence };
  });
}
