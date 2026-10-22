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
import { existsSync, readFileSync } from 'node:fs';

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
