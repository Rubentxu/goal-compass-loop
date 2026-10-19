/**
 * Propuestas de trabajo surgidas durante la sesión.
 *
 * Cuando el agente llega a un punto sin trabajo obvious, puede proponer el
 * siguiente objetivo. La propuesta no entra en el journal: vive en un
 * fichero aparte, como el canal de control, para que el proceso que encadena
 * objetivos siga siendo el único que escribe el journal.
 *
 * Una propuesta solo se acepta si su evidencia señala a un fichero que
 * existe de verdad. Sin eso, no hay trabajo: solo una intención.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { candidateKey, type Candidate } from '../core/types.js';
import type { CandidatePort } from '../ports.js';
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

/** Convierte las propuestas en candidatos que el supervisor puede encadenar. */
export function proposalsToCandidates(
  missionId: string,
  workspace: string,
): Candidate[] {
  return readProposals(missionId)
    .filter((proposal) => evidenceExists(workspace, proposal.evidenceRefs))
    .map((proposal) => ({
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
    }));
}

/**
 * Fuente de candidatos que ofrece lo propuesto durante la sesión.
 *
 * Va despues del backlog declarado por el usuario, que manda, y antes de las
 * señales automaticas del repositorio, porque una propuesta ya viene
 * investigada y con su evidencia puesta.
 */
export class ProposalCandidatePort implements CandidatePort {
  constructor(private readonly workspace: string) {}

  async discover(mission: { missionId: string }): Promise<Candidate[]> {
    return proposalsToCandidates(mission.missionId, this.workspace);
  }
}

/** Clave estable de un candidato, para deduplicar. */
export { candidateKey };
