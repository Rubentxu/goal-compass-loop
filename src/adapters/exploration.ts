/**
 * Exploracion acotada del trabajo pendiente.
 *
 * Cuando las fuentes deterministas (backlog y senales del codigo) no ofrecen
 * nada, se puede pedir al agente del host una propuesta de trabajo. La
 * propuesta es una pista, no una orden: para entrar en la cadena tiene que
 * superar el mismo filtro que el resto de candidatos y, ademas, su evidencia
 * tiene que apuntar a un fichero que exista de verdad en el workspace.
 *
 * Esa ultima comprobacion es la que impide el trabajo inventado: una tarea
 * sobre un fichero inexistente se descarta.
 */
import { existsSync, statSync } from 'node:fs';
import { isAbsolute, join, normalize, relative, resolve } from 'node:path';
import type { Candidate, GoalState, Mission } from '../core/types.js';
import type { ExplorationPort, TextSession } from '../ports.js';

const MAX_PROPOSALS = 3;

/** Propuesta en bruto, tal y como la devuelve el agente. */
interface Proposal {
  objective: string;
  whyNow: string;
  evidenceRefs: string[];
  doneWhen: string[];
  scope: string | undefined;
  risk: 'low' | 'medium' | 'high';
  priority: number;
}

/** Consulta acotada: pocas tareas, con evidencia y criterio de cierre. */
function buildQuestion(mission: Mission): string {
  return [
    `Explora el repositorio en busca de trabajo real y pendiente, y propón como máximo ${MAX_PROPOSALS} tareas.`,
    '',
    `Objetivo de la misión: ${mission.objective}`,
    '',
    'Devuelve SOLO un array JSON, sin texto alrededor, con esta forma por tarea:',
    '{ "objective": "...", "whyNow": "...", "evidenceRefs": ["ruta/fichero"],',
    '  "doneWhen": ["condición observable"], "scope": "...", "risk": "low|medium|high", "priority": 0 }',
    '',
    'Reglas:',
    '- Cada tarea debe señalar al menos un fichero del repositorio que exista y la sustenta.',
    '- La tarea debe ser algo pendiente de verdad, no una mejora genérica ni algo ya hecho.',
    '- Si no hay trabajo real, devuelve [].',
  ].join('\n');
}

/** Extrae el primer array JSON de la respuesta. */
function extractJsonArray(text: string): unknown[] | null {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Convierte la respuesta cruda en propuestas validas. */
function parseProposals(text: string): Proposal[] {
  const raw = extractJsonArray(text);
  if (!raw) return [];

  const proposals: Proposal[] = [];
  for (const item of raw.slice(0, MAX_PROPOSALS)) {
    if (typeof item !== 'object' || item === null) continue;
    const record = item as Record<string, unknown>;

    const objective = typeof record.objective === 'string' ? record.objective.trim() : '';
    const evidenceRefs = Array.isArray(record.evidenceRefs)
      ? record.evidenceRefs.filter((ref): ref is string => typeof ref === 'string')
      : [];
    const doneWhen = Array.isArray(record.doneWhen)
      ? record.doneWhen.filter((item): item is string => typeof item === 'string')
      : [];
    if (!objective || evidenceRefs.length === 0 || doneWhen.length === 0) continue;

    const risk = record.risk;
    proposals.push({
      objective,
      whyNow: typeof record.whyNow === 'string' ? record.whyNow.trim() : '',
      evidenceRefs,
      doneWhen,
      scope: typeof record.scope === 'string' ? record.scope : undefined,
      risk: risk === 'low' || risk === 'medium' || risk === 'high' ? risk : 'medium',
      priority: typeof record.priority === 'number' ? record.priority : 0,
    });
  }
  return proposals;
}

/** Explora el workspace preguntando al agente del host. */
export class SessionExploration implements ExplorationPort {
  constructor(
    private readonly session: TextSession,
    private readonly workspace: string,
  ) {}

  async explore(mission: Mission, _previousGoal: GoalState | null): Promise<Candidate[]> {
    const answer = await this.session.ask(buildQuestion(mission));
    return parseProposals(answer)
      .filter((proposal) => proposal.evidenceRefs.some((ref) => this.pointsToRealFile(ref)))
      .map((proposal, index) => toCandidate(proposal, index));
  }

  /** La evidencia tiene que senalar a un fichero que exista dentro del workspace. */
  private pointsToRealFile(reference: string): boolean {
    const withoutLine = reference.split(':')[0]!.trim();
    if (!withoutLine) return false;

    const target = isAbsolute(withoutLine)
      ? withoutLine
      : resolve(join(this.workspace, normalize(withoutLine)));
    const insideWorkspace =
      relative(resolve(this.workspace), target) === '' ||
      !relative(resolve(this.workspace), target).startsWith('..');
    if (!insideWorkspace) return false;

    try {
      return existsSync(target) && statSync(target).isFile();
    } catch {
      return false;
    }
  }
}

function toCandidate(proposal: Proposal, index: number): Candidate {
  return {
    candidateId: `exploracion:${index}:${proposal.objective.slice(0, 40)}`,
    objective: proposal.objective,
    whyNow: proposal.whyNow || 'propuesto en la exploracion del workspace',
    evidenceRefs: proposal.evidenceRefs,
    doneWhen: proposal.doneWhen,
    ...(proposal.scope !== undefined ? { scope: proposal.scope } : {}),
    risk: proposal.risk,
    priority: proposal.priority,
    prerequisites: [],
    source: 'investigation',
  };
}
