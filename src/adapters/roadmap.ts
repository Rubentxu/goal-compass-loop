/**
 * El roadmap como fuente de verdad.
 *
 * El roadmap dice qué falta. Cuando una sección se cierra, deja de faltar: y
 * una propuesta que apuntaba a esa sección ya no es trabajo futuro, sino
 * trabajo pasado que se volvería a ofrecer.
 *
 * Por eso se lee el estado de la sección a la que apunta la evidencia de una
 * propuesta. No es una heuristica: el roadmap dice `**Estado:** cerrado` y eso
 * es lo que se obedece.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

/** Si una sección del roadmap sigue abierta o ya está cerrada. */
export type RoadmapStatus = 'abierto' | 'cerrado';

/** Una sección del roadmap, con lo que se sabe de ella. */
export interface RoadmapSection {
  /** El ancla de la sección, tal cual (`p2`). */
  anchor: string;
  /** El título de la sección, si lo tiene. */
  title: string | null;
  /** Si la sección sigue abierta. */
  status: RoadmapStatus;
  /** El texto de la sección. */
  text: string;
}

/**
 * Lee la sección del roadmap que hay bajo un ancla.
 *
 * Devuelve `null` si el fichero no existe o si no hay ninguna sección con esa
 * ancla: entonces no se puede decir nada, y no se inventa.
 */
export function roadmapSection(path: string, anchor: string): RoadmapSection | null {
  if (!existsSync(path)) return null;

  const text = readFileSync(path, 'utf8');
  const marker = `<a id="${anchor}"></a>`;
  const start = text.indexOf(marker);
  if (start < 0) return null;

  const rest = text.slice(start + marker.length);
  const nextAnchor = rest.search(/<a id="[^"]+"><\/a>/);
  const section = nextAnchor < 0 ? rest : rest.slice(0, nextAnchor);

  const titleMatch = /^#{1,3}\s+(.+)$/m.exec(section);
  const closed = /\*\*Estado:\*\*\s*cerrado/i.test(section);

  return {
    anchor,
    title: titleMatch?.[1]?.trim() ?? null,
    status: closed ? 'cerrado' : 'abierto',
    text: section,
  };
}

/**
 * Si la evidencia de una propuesta apunta a una sección cerrada.
 *
 * Solo mira las referencias con ancla: un fichero sin ancla es una prueba de
 * que el trabajo existe, no de que siga pendiente.
 */
export function evidenceSectionClosed(workspace: string, evidenceRefs: string[]): boolean {
  for (const ref of evidenceRefs) {
    const [path, anchor] = ref.split('#');
    if (!path || !anchor) continue;
    const section = roadmapSection(`${workspace}/${path}`, anchor);
    if (section?.status === 'cerrado') return true;
  }
  return false;
}

/** Lo que pasó al cerrar una sección. */
export interface CloseResult {
  /** Si la sección estaba ya cerrada. */
  alreadyClosed: boolean;
  /** El texto nuevo de la sección. */
  section: string;
}

/**
 * Cierra una sección del roadmap, dejando por qué.
 *
 * Escribe solo el estado: el resto de la sección no se toca, porque es
 * historia de lo que se decidió y por qué. Si la sección ya estaba cerrada no
 * se reescribe: se dice y se deja como estaba.
 *
 * Un estado cerrado deja de ofrecer trabajo, así que el motivo importa: es lo
 * que le dice a quien llegue después qué se hizo y por qué ya no hace falta.
 */
export function closeRoadmapSection(path: string, anchor: string, reason: string): CloseResult {
  const section = roadmapSection(path, anchor);
  if (!section) throw new Error(`el roadmap no tiene ninguna seccion con el ancla "${anchor}"`);
  if (section.status === 'cerrado') {
    return { alreadyClosed: true, section: section.text };
  }

  const estado = `**Estado:** cerrado (${reason})`;
  const original = readFileSync(path, 'utf8');
  const marker = `<a id="${anchor}"></a>`;
  const start = original.indexOf(marker);
  if (start < 0) throw new Error(`el roadmap no tiene ninguna seccion con el ancla "${anchor}"`);

  const before = original.slice(0, start + marker.length);
  const rest = original.slice(start + marker.length);
  const nextAnchor = rest.search(/<a id="[^"]+"><\/a>/);
  const body = nextAnchor < 0 ? rest : rest.slice(0, nextAnchor);
  const after = nextAnchor < 0 ? '' : rest.slice(nextAnchor);

  const cerrada = /\*\*Estado:\*\*[^\n]*/.test(body)
    ? body.replace(/\*\*Estado:\*\*[^\n]*/, estado)
    : insertEstado(body, estado);

  writeFileSync(path, `${before}${cerrada}${after}`, 'utf8');
  return { alreadyClosed: false, section: cerrada };
}

/**
 * Pone el estado donde se lee: debajo del titulo, antes de que la seccion
 * se explique.
 */
function insertEstado(body: string, estado: string): string {
  const lines = body.split('\n');
  const titulo = lines.findIndex((line) => /^#{1,3}\s+/.test(line));
  if (titulo < 0) return `${estado}\n${body}`;
  const despues: string[] = [];
  let inserted = false;
  for (const line of lines) {
    despues.push(line);
    if (!inserted && /^#{1,3}\s+/.test(line)) {
      despues.push('');
      despues.push(estado);
      inserted = true;
    }
  }
  return despues.join('\n');
}
