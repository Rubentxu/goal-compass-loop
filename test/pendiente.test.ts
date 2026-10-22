/**
 * Que trabajo sigue pendiente.
 *
 * El backlog declarado y las propuestas de la sesion tienen que responder a la
 * misma pregunta con la misma regla. Si cada uno aplica la suya, el menu de
 * trabajo ofrece trabajo que el proyecto ya dio por hecho, y la cadena vuelve
 * a pagar lo que ya estaba pagado.
 */
import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import { join } from 'node:path';
import { cleanupTempDirs, tempDir } from './support/temp.js';
import { MissionConfigCandidatePort } from '../src/adapters/candidates.js';
import { reviewProposals, writeProposal } from '../src/adapters/proposals.js';
import { aCandidate, aMission, unWorkspaceConRoadmap, unaDeclaracion } from './support/harness.js';

describe('el backlog declarado', () => {
  afterEach(cleanupTempDirs);

  it('deja fuera el trabajo cuya seccion del roadmap esta cerrada', async () => {
    const workspace = unWorkspaceConRoadmap();
    const path = unaDeclaracion(workspace, {
      backlog: [
        aCandidate({
          candidateId: 'pagado',
          objective: 'Trabajo que el proyecto ya cerro',
          evidenceRefs: ['docs/roadmap.md#cerrado'],
        }),
        aCandidate({
          candidateId: 'pendiente',
          objective: 'Trabajo que sigue en pie',
          evidenceRefs: ['docs/roadmap.md#abierto'],
        }),
      ],
    });

    const candidates = await new MissionConfigCandidatePort(path).discover(
      aMission({ workspace }),
      null,
    );

    expect(candidates.map((c) => c.candidateId)).toEqual(['pendiente']);
  });

  it('el backlog guardado en el journal obeyece la misma regla', async () => {
    const workspace = unWorkspaceConRoadmap();
    const port = new MissionConfigCandidatePort(join(workspace, 'no-existe.json'));
    const mission = aMission({
      workspace,
      backlog: [
        aCandidate({
          candidateId: 'pagado',
          objective: 'Trabajo que el proyecto ya cerro',
          evidenceRefs: ['docs/roadmap.md#cerrado'],
        }),
      ],
    });

    expect(await port.discover(mission, null)).toHaveLength(0);
  });
});

describe('las propuestas de la sesion', () => {
  let previousStateHome: string | undefined;

  beforeEach(() => {
    previousStateHome = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = tempDir('gcl-pendiente-state-');
  });

  afterEach(() => {
    if (previousStateHome === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = previousStateHome;
    cleanupTempDirs();
  });

  it('la revision la marca como seccion cerrada', () => {
    const workspace = unWorkspaceConRoadmap();
    writeProposal('mision-pendiente', {
      candidateId: 'propuesta:1',
      objective: 'Trabajo que el proyecto ya cerro',
      whyNow: 'porque si',
      evidenceRefs: ['docs/roadmap.md#cerrado'],
      doneWhen: ['esta hecho'],
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    const verdicts = reviewProposals('mision-pendiente', workspace, new Set());

    expect(verdicts[0]?.defect).toBe('seccion-cerrada');
  });

  it('el trabajo abierto se ofrece', () => {
    const workspace = unWorkspaceConRoadmap();
    writeProposal('mision-pendiente', {
      candidateId: 'propuesta:1',
      objective: 'Trabajo que sigue en pie',
      whyNow: 'porque si',
      evidenceRefs: ['docs/roadmap.md#abierto'],
      doneWhen: ['esta hecho'],
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    const verdicts = reviewProposals('mision-pendiente', workspace, new Set());

    expect(verdicts[0]?.defect).toBeNull();
  });
});
