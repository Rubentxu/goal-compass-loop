/**
 * Propuestas de trabajo surgidas durante la sesión.
 *
 * Cuando el agente llega a un punto sin trabajo obvious, puede proponer el
 * siguiente objetivo. La propuesta no entra en el journal: vive en un
 * fichero aparte, como el canal de control, para que el proceso que encadena
 * objetivos siga siendo el único que escribe el journal.
 *
 * Una propuesta solo se acepta si su evidencia señala a un fichero que
 * existe de verdad y si dice cómo se sabrá que está hecha. Son las mismas
 * condiciones que el nucleo exige a cualquier candidato: sin eso, no hay
 * trabajo, solo una intención.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { candidateKey, type Candidate } from '../core/types.js';
import { candidateDefect, type CandidateDefect } from '../core/decide.js';
import type { CandidatePort } from '../ports.js';
import { isCompleted, workspaceCompletedObjectives, type CompletedObjectives } from './ledger.js';
import { stateRoot } from './journal.js';

/** Propuesta pendiente de encadenar. */
export interface Proposal {
  candidateId: string;
  objective: string;
  whyNow: string;
  evidenceRefs: string[];
  doneWhen: string[];
  createdAt: string;
}

/** Ruta del fichero de propuestas de una misión. */
export function proposalsPath(missionId: string): string {
  return join(stateRoot(), missionId, 'proposals.json');
}

/** Lee las propuestas de una misión; si no hay, la lista está vacía. */
export function readProposals(missionId: string): Proposal[] {
  try {
    const raw = JSON.parse(readFileSync(proposalsPath(missionId), 'utf8')) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (entry): entry is Proposal =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as Proposal).objective === 'string',
    );
  } catch {
    return [];
  }
}

/** Añade una propuesta y la persiste de forma atómica. */
export function writeProposal(missionId: string, proposal: Proposal): void {
  const path = proposalsPath(missionId);
  const existing = readProposals(missionId).filter(
    (entry) => entry.candidateId !== proposal.candidateId,
  );
  existing.push(proposal);
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(existing, null, 2)}\n`, 'utf8');
  renameSync(temporary, path);
}

/**
 * Comprueba que la evidencia de una propuesta existe dentro del workspace.
 *
 * Es el mismo candado que usa la exploración: sin un fichero real al que
 * señalar, la propuesta se descarta.
 */
export function evidenceExists(workspace: string, evidenceRefs: string[]): boolean {
  if (evidenceRefs.length === 0) return false;
  return evidenceRefs.some((ref) => {
    const path = ref.split('#')[0] ?? '';
    if (!path) return false;
    return existsSync(join(workspace, path));
  });
}

/**
 * Una propuesta y el motivo por el que todavia no puede ser trabajo.
 *
 * `defect` es `null` cuando la propuesta es utilizable tal cual.
 */
export interface ProposalVerdict {
  proposal: Proposal;
  defect: CandidateDefect | null;
}

/**
 * Revisa las propuestas pendientes y explica las que no pueden ser trabajo.
 *
 * La evidencia tiene que existir de verdad y hace falta un criterio de cierre
 * observable: son las mismas condiciones que el nucleo exige a cualquier
 * candidato, no un filtro propio de este canal. A eso se suma el historial: una
 * propuesta cuyo trabajo ya se ejecutó no vuelve a ofrecerse, porque el
 * objetivo de una propuesta es trabajo nuevo.
 */
export function reviewProposals(
  missionId: string,
  workspace: string,
  completed: CompletedObjectives = workspaceCompletedObjectives(workspace),
): ProposalVerdict[] {
  return readProposals(missionId).map((proposal) => {
    if (isCompleted(completed, proposal.objective)) {
      return { proposal, defect: 'ya-completado' as const };
    }
    if (!evidenceExists(workspace, proposal.evidenceRefs)) {
      return { proposal, defect: 'sin-evidencia' as const };
    }
    return { proposal, defect: candidateDefect(proposalToCandidate(proposal)) };
  });
}

/** Convierte una propuesta en el candidato que el supervisor puede encadenar. */
function proposalToCandidate(proposal: Proposal): Candidate {
  return {
    candidateId: proposal.candidateId,
    objective: proposal.objective,
    whyNow: proposal.whyNow,
    evidenceRefs: proposal.evidenceRefs,
    doneWhen: proposal.doneWhen,
    scope: 'workspace',
    risk: 'medium' as const,
    priority: 5,
    prerequisites: [],
    source: 'investigation' as const,
  };
}

/** Convierte las propuestas utilizables en candidatos que el supervisor puede encadenar. */
export function proposalsToCandidates(
  missionId: string,
  workspace: string,
  completed: CompletedObjectives = workspaceCompletedObjectives(workspace),
): Candidate[] {
  return reviewProposals(missionId, workspace, completed)
    .filter((verdict) => verdict.defect === null)
    .map((verdict) => proposalToCandidate(verdict.proposal));
}

/**
 * Fuente de candidatos que ofrece lo propuesto durante la sesión.
 *
 * Va despues del backlog declarado por el usuario, que manda, y antes de las
 * señales automaticas del repositorio, porque una propuesta ya viene
 * investigada y con su evidencia puesta.
 *
 * Lo ya ejecutado no se ofrece: una propuesta es trabajo futuro, y repetir un
 * trabajo pagado es la forma mas cara de perder un ciclo.
 */
export class ProposalCandidatePort implements CandidatePort {
  private readonly completed: CompletedObjectives;

  constructor(
    private readonly workspace: string,
    completed?: CompletedObjectives,
  ) {
    this.completed = completed ?? workspaceCompletedObjectives(workspace);
  }

  async discover(mission: { missionId: string }): Promise<Candidate[]> {
    return proposalsToCandidates(mission.missionId, this.workspace, this.completed);
  }
}

/** Clave estable de un candidato, para deduplicar. */
export { candidateKey };
