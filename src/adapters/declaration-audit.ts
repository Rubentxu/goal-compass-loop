/**
 * Auditoría de una declaración de misión.
 *
 * Una declaración puede estar escrita con el vocabulario equivocado y no decir
 * nada: el cargador lee unos campos y solo esos, y lo que no lee se pierde en
 * silencio. El peor caso es una declaración que *parece* llevar la evidencia
 * —porque el campo se llama `evidence` y su valor es una ruta que existe— y
 * que en realidad la pierde entera: todos sus candidatos quedan descartados
 * y la cadena no tiene nada que encadenar.
 *
 * Aquí se mira el fichero tal cual está y se dice qué se va a perder, con el
 * arreglo debajo cuando se sabe. Solo lee: una auditoría que escribiera en el
 * proyecto ajeno no sería una auditoría.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { candidateDefect } from '../core/decide.js';
import { loadMissionConfig, type MissionConfig } from './mission.js';

/** Lo que le pasa a una declaración. */
export type AuditKind =
  | 'sin-evidencia'
  | 'sin-criterio-observable'
  | 'campo-desconocido'
  | 'referencia-rota'
  | 'ancla-rota'
  | 'prioridad-invertida';

/** Un problema encontrado en una declaración. */
export interface AuditProblem {
  kind: AuditKind;
  /** Candidato afectado, cuando el problema es de uno. */
  candidateId?: string;
  /** Qué pasa, en una frase. */
  detail: string;
  /** Qué se puede hacer para arreglarlo, cuando se sabe. */
  hint?: string;
}

/** El resultado de auditar una declaración. */
export interface DeclarationAudit {
  missionId: string;
  workspace: string;
  /** Ruta del fichero de declaración. */
  path: string;
  /** Candidatos declarados. */
  candidates: number;
  /** Candidatos que el selector puede usar tal cual. */
  ready: number;
  /** Candidatos que el selector descarta. */
  discarded: number;
  /** Problemas encontrados, en el orden en que se encontraron. */
  problems: AuditProblem[];
  /**
   * Campos que el cargador no lee y que no son un problema.
   *
   * Un autor puede escribir de mas: la informacion se pierde, pero el
   * candidato sigue siendo valido. Eso se dice una vez, no por candidato.
   */
  ignoredFields: string[];
}

/** Campos que el cargador de candidatos entiende. */
const CAMPOS_CONOCIDOS = new Set([
  'candidateId',
  'objective',
  'whyNow',
  'evidenceRefs',
  'doneWhen',
  'scope',
  'risk',
  'priority',
  'prerequisites',
  'source',
  'tokenBudget',
]);

/**
 * Campos que no se leen pero se parecen a uno que sí, con el nombre bueno.
 *
 * El caso de `evidence` es el que duele: el valor es una ruta que existe y el
 * autor cree que la ha dejado. Por eso se dice cuál era el campo que había
 * que escribir.
 */
const SUGERENCIAS: Record<string, string> = {
  evidence: 'evidenceRefs',
  evidenceRef: 'evidenceRefs',
  evidences: 'evidenceRefs',
  done: 'doneWhen',
  criteria: 'doneWhen',
  criterion: 'doneWhen',
  donewhen: 'doneWhen',
  whynow: 'whyNow',
  id: 'candidateId',
};

/**
 * Audita la declaración de una misión.
 *
 * Devuelve también la configuración ya leída, porque quien audita la
 * necesita para saber qué haría el selector con ella.
 */
export function auditDeclaration(
  configPath: string,
  options: { workspace?: string } = {},
): DeclarationAudit & { config: MissionConfig } {
  const workspace = options.workspace ?? resolve(configPath, '..');
  const config = loadMissionConfig(configPath, { workspace });
  const problems: AuditProblem[] = [];
  const ignored = new Set<string>();

  let raw: unknown = undefined;
  try {
    raw = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch {
    // El cargador ya falló si el fichero no se puede leer; aqui no se anade otro problema sobre el mismo error.
  }

  const backlog = Array.isArray(raw) ? [] : Array.isArray((raw as Record<string, unknown>)?.backlog)
    ? ((raw as Record<string, unknown>).backlog as unknown[])
    : [];

  for (const entry of backlog) {
    if (typeof entry !== 'object' || entry === null) continue;
    const candidato = entry as Record<string, unknown>;
    const candidateId =
      typeof candidato.candidateId === 'string' ? candidato.candidateId : '(sin identificador)';

    // Campos que el cargador no lee.
    for (const field of Object.keys(candidato)) {
      if (CAMPOS_CONOCIDOS.has(field)) continue;
      const sugerencia = SUGERENCIAS[field];
      if (!sugerencia) {
        // Un campo de mas no rompe el candidato: solo se pierde su valor.
        if (!ignored.has(field)) ignored.add(field);
        continue;
      }
      problems.push({
        kind: 'campo-desconocido',
        candidateId,
        detail: `el campo "${field}" no lo lee el cargador`,
        hint: `el campo que si se lee es "${sugerencia}"`,
      });
    }

    // El filtro que el propio selector aplica.
    const parsed = config.backlog.find((c) => c.candidateId === candidateId);
    if (parsed) {
      const defecto = candidateDefect(parsed);
      if (defecto === 'sin-evidencia') {
        problems.push({
          kind: 'sin-evidencia',
          candidateId,
          detail: 'el candidato se descarta: no tiene evidencia',
          hint: 'su campo evidenceRefs tiene que traer al menos una referencia',
        });
      } else if (defecto === 'sin-criterio-observable') {
        problems.push({
          kind: 'sin-criterio-observable',
          candidateId,
          detail: 'el candidato se descarta: no tiene criterio de cierre observable',
          hint: 'su campo doneWhen tiene que traer al menos una condicion',
        });
      }
    }

    // Las referencias: una ruta que existe y un ancla que existe.
    for (const ref of refsOf(candidato)) {
      const problema = checkReference(ref, workspace);
      if (problema) problems.push({ ...problema, candidateId });
    }
  }

  // La prioridad: el selector ordena de mayor a menor. Una cola escrita al
  // reves hace que la cadena empiece por el final.
  const invertida = priorityInverted(config);
  if (invertida) problems.push(invertida);

  const descartados = problems.filter((p) =>
    p.kind === 'sin-evidencia' || p.kind === 'sin-criterio-observable',
  ).length;

  return {
    missionId: config.missionId,
    workspace: config.workspace,
    path: configPath,
    candidates: config.backlog.length,
    ready: config.backlog.length - descartados,
    discarded: descartados,
    problems,
    ignoredFields: [...ignored].sort(),
    config,
  };
}

/** Las referencias de un candidato, estén donde estén escritas. */
function refsOf(candidato: Record<string, unknown>): string[] {
  const refs: string[] = [];
  const direct = candidato.evidenceRefs;
  if (Array.isArray(direct)) {
    for (const ref of direct) if (typeof ref === 'string') refs.push(ref);
  }
  // La evidencia mal escrita tambien es una referencia que hay que mirar:
  // aunque el cargador no la lea, su valor puede apuntar a la nada.
  const suelta = candidato.evidence;
  if (typeof suelta === 'string' && suelta.trim() !== '') refs.push(suelta.trim());
  return refs;
}

/**
 * Comprueba una referencia: la ruta tiene que existir y el ancla, si la hay,
 * tiene que estar en el fichero.
 */
function checkReference(ref: string, workspace: string): AuditProblem | undefined {
  const [fichero, ancla] = splitReference(ref);
  if (!fichero) return undefined;

  const ruta = resolve(workspace, fichero);
  if (!existsSync(ruta)) {
    return {
      kind: 'referencia-rota',
      detail: `la referencia "${ref}" no apunta a ningun fichero`,
      hint: 'la ruta es relativa al proyecto donde vive la declaracion',
    };
  }

  if (!ancla) return undefined;

  let contenido = '';
  try {
    contenido = readFileSync(ruta, 'utf8');
  } catch {
    return undefined;
  }

  if (anchorExists(contenido, ancla)) return undefined;

  return {
    kind: 'ancla-rota',
    detail: `la referencia "${ref}" no encuentra el ancla "${ancla}" en ${fichero}`,
    hint: 'el ancla es un id explicito (<a id="...">) o el numero de una seccion',
  };
}

/** Separa la referencia en ruta y ancla. */
function splitReference(ref: string): [string, string | undefined] {
  const index = ref.indexOf('#');
  if (index === -1) return [ref.trim(), undefined];
  return [ref.slice(0, index).trim(), ref.slice(index + 1).trim()];
}

/**
 * Dice si el ancla existe en el contenido.
 *
 * Se admiten tres formas: un id explicto, el titulo de una seccion tal como
 * lo convierte GitHub en enlace, y el numero de una seccion numerada.
 */
export function anchorExists(contenido: string, ancla: string): boolean {
  if (ancla === '') return true;

  // 1. Ancla explicita.
  const escaped = ancla.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`(?:id|name)\\s*=\\s*["']${escaped}["']`).test(contenido)) return true;

  // 2. Numero de seccion: "2.2" o "3".
  if (/^[\d.]+$/.test(ancla)) {
    const seccion = new RegExp(`^#{1,6}\\s*${escaped}(?:\\s|$)`, 'm');
    if (seccion.test(contenido)) return true;
  }

  // 3. Titulo de seccion, como lo convierte GitHub en enlace.
  const slugs = [...contenido.matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => slugify(m[1] ?? ''));
  return slugs.includes(ancla.toLowerCase());
}

/**
 * Convierte un titulo en el ancla que GitHub le pone.
 *
 * Se quita el formato, se baja a minusculas y los espacios pasan a guiones.
 */
export function slugify(titulo: string): string {
  return titulo
    .replace(/`/g, '')
    .replace(/\*\*/g, '')
    .replace(/[*_~]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-');
}

/**
 * Dice si la cola esta escrita al reves.
 *
 * El selector ordena de mayor a menor. Si el primer candidato del fichero
 * tiene la prioridad mas baja de todas, la cadena empezaria por el ultimo.
 */
function priorityInverted(config: MissionConfig): AuditProblem | undefined {
  const backlog = config.backlog;
  if (backlog.length < 3) return undefined;

  const prioridades = backlog.map((c) => c.priority);
  const maximo = Math.max(...prioridades);
  const minimo = Math.min(...prioridades);
  if (maximo === minimo) return undefined;

  const primero = backlog[0]!;
  if (primero.priority !== minimo) return undefined;

  return {
    kind: 'prioridad-invertida',
    candidateId: primero.candidateId,
    detail:
      'el primer candidato del fichero tiene la prioridad mas baja: el selector ' +
      'elige al ultimo, y no al primero',
    hint: 'la prioridad va de mayor a menor: mas alto, antes',
  };
}
