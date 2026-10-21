/**
 * Fuentes de candidatos y su composicion.
 *
 * El supervisor solo conoce el puerto: como se reunen los candidatos es un
 * detalle de adaptacion. La composicion permite combinar un backlog curado
 * con lo que se descubre en el workspace sin tocar el nucleo.
 */
import { loadMissionConfig } from './mission.js';
import { WorkspaceEvidenceScanner, type Evidence } from './discovery.js';
import { completedObjectives, isCompleted, type CompletedObjectives } from './ledger.js';
import { normalize, type Candidate, type GoalState, type Mission } from '../core/types.js';
import type { CandidatePort } from '../ports.js';

/**
 * Candidatos declarados en el fichero de la mision, releidos en cada consulta.
 *
 * Lo que el mismo fichero dice que ya se hizo no se vuelve a ofrecer: el
 * backlog es lo que queda, no la historia.
 */
export class MissionConfigCandidatePort implements CandidatePort {
  private readonly completed: CompletedObjectives;

  constructor(
    private readonly configPath: string,
    completed?: CompletedObjectives,
  ) {
    this.completed = completed ?? completedObjectives(configPath);
  }

  async discover(mission: Mission, _previousGoal: GoalState | null): Promise<Candidate[]> {
    try {
      const config = loadMissionConfig(this.configPath);
      if (config.backlog.length > 0) {
        return config.backlog.filter(
          (candidate) => !isCompleted(this.completed, candidate.objective),
        );
      }
    } catch {
      /* fichero ilegible: se sigue con el backlog guardado en el journal */
    }
    return mission.backlog.filter(
      (candidate) => !isCompleted(this.completed, candidate.objective),
    );
  }
}

/**
 * Candidatos derivados de las señales del workspace.
 *
 * La prioridad es baja a proposito: el backlog curado por el usuario manda,
 * y lo descubierto solo entra cuando el backlog no ofrece trabajo.
 */
export class WorkspaceDiscovery implements CandidatePort {
  constructor(private readonly scanner: WorkspaceEvidenceScanner = new WorkspaceEvidenceScanner()) {}

  async discover(mission: Mission, _previousGoal: GoalState | null): Promise<Candidate[]> {
    const evidence = await this.scanner.scan(mission.workspace);
    return evidence.map(toCandidate);
  }
}

/** Reune candidatos de varias fuentes, sin repetir y en orden de fuente. */
export class ComposedCandidatePort implements CandidatePort {
  constructor(private readonly sources: CandidatePort[]) {}

  async discover(mission: Mission, previousGoal: GoalState | null): Promise<Candidate[]> {
    const collected: Candidate[] = [];
    for (const source of this.sources) {
      collected.push(...(await source.discover(mission, previousGoal)));
    }
    return collapse(collected);
  }
}

/** Traduce una señal localizada en el workspace a un candidato con criterio de cierre. */
function toCandidate(evidence: Evidence): Candidate {
  return {
    candidateId: `evidencia:${evidence.kind}:${evidence.location}`,
    objective: evidence.objective,
    whyNow: `Pendiente observado en ${evidence.location}`,
    evidenceRefs: [evidence.location],
    doneWhen: evidence.doneWhen,
    scope: 'workspace',
    risk: 'low',
    priority: 0,
    prerequisites: [],
    source: 'observed',
  };
}

/**
 * Elimina repeticiones conservando la primera aparicion.
 *
 * Lo que se repite es la intencion, no el identificador: el mismo trabajo
 * puede llegar por dos canales (el backlog curado y una propuesta) con
 * atributos distintos, y en el menu de trabajo tiene que aparecer una vez.
 * Se conserva la primera, que es la del canal curado, porque es la que
 * alguien ha cuidado.
 */
function collapse(candidates: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  const unique: Candidate[] = [];
  for (const candidate of candidates) {
    const intention = normalize(candidate.objective);
    if (seen.has(intention)) continue;
    seen.add(intention);
    unique.push(candidate);
  }
  return unique;
}
