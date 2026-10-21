/**
 * El ledger de trabajo ya ejecutado.
 *
 * Se comprueba que lo ya hecho se lee del fichero de la mision, que se
 * reconoce por intencion y no por texto exacto, y que ni el backlog ni las
 * propuestas vuelven a ofrecerlo como trabajo.
 */
import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import { cleanupTempDirs, tempDir } from './support/temp.js';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { completedObjectives, isCompleted, readExecutedLedger } from '../src/adapters/ledger.js';
import { MissionConfigCandidatePort } from '../src/adapters/candidates.js';
import { ProposalCandidatePort, reviewProposals, writeProposal } from '../src/adapters/proposals.js';
import { aMission } from './support/harness.js';

afterEach(cleanupTempDirs);

const HECHO = 'Publicar la lectura del saga en el verbo de solo lectura';
const PENDIENTE = 'Anadir la compatibilidad del plan al estado pendiente';

function missionFile(executed: unknown[], backlog: unknown[] = []): string {
  const directory = tempDir('gcl-ledger-');
  const path = join(directory, 'goal-compass.json');
  writeFileSync(
    path,
    JSON.stringify({
      missionId: 'mision-ledger',
      objective: 'Trabajar sin repetir',
      workspace: directory,
      defaultTokenBudget: 100_000,
      totalTokenBudget: null,
      backlog,
      executed,
    }),
    'utf8',
  );
  return path;
}

const unCandidato = (candidateId: string, objective: string) => ({
  candidateId,
  objective,
  whyNow: 'Es el trabajo declarado',
  evidenceRefs: ['NOTAS.md'],
  doneWhen: ['El trabajo esta hecho'],
  risk: 'low',
  priority: 5,
  prerequisites: [],
  source: 'roadmap',
});

describe('ledger de trabajo ejecutado', () => {
  it('lee lo que el workspace dice que ya hizo', () => {
    const path = missionFile([
      { candidateId: 'hecho', objective: HECHO, receipt: 'PR #1' },
      { candidateId: 'pendiente', objective: PENDIENTE },
    ]);

    const entries = readExecutedLedger(path);

    expect(entries).toHaveLength(2);
    expect(entries[0]?.candidateId).toBe('hecho');
    expect(entries[0]?.objective).toBe(HECHO);
  });

  it('un fichero ilegible se lee como un ledger vacio, sin lanzar', () => {
    const path = join(tempDir('gcl-ledger-roto-'), 'goal-compass.json');
    writeFileSync(path, 'esto no es json', 'utf8');

    expect(readExecutedLedger(path)).toEqual([]);
    expect(completedObjectives(path).size).toBe(0);
  });

  it('una entrada sin objetivo no cuenta como trabajo hecho', () => {
    const path = missionFile([{ candidateId: 'sin-objetivo' }, null, 'texto']);

    expect(readExecutedLedger(path)).toEqual([]);
  });

  it('la misma intencion escrita de otra forma se reconoce', () => {
    const completed = completedObjectives(missionFile([{ objective: HECHO }]));

    expect(isCompleted(completed, HECHO)).toBe(true);
    expect(isCompleted(completed, `  ${HECHO.toUpperCase()}  `)).toBe(true);
    expect(isCompleted(completed, PENDIENTE)).toBe(false);
  });
});

describe('el backlog no ofrece lo que ya se ejecuto', () => {
  it('deja fuera el candidato ya ejecutado y conserva el que falta', async () => {
    const path = missionFile(
      [{ candidateId: 'hecho', objective: HECHO }],
      [unCandidato('hecho', HECHO), unCandidato('pendiente', PENDIENTE)],
    );

    const port = new MissionConfigCandidatePort(path);
    const candidates = await port.discover(aMission(), null);

    expect(candidates.map((c) => c.candidateId)).toEqual(['pendiente']);
  });

  it('sin ledger, el backlog se ofrece entero', async () => {
    const path = missionFile([], [unCandidato('pendiente', PENDIENTE)]);

    const port = new MissionConfigCandidatePort(path);
    const candidates = await port.discover(aMission(), null);

    expect(candidates).toHaveLength(1);
  });
});

describe('una propuesta ya ejecutada no es trabajo', () => {
  let workspace: string;
  let previousStateHome: string | undefined;

  beforeEach(() => {
    workspace = tempDir('gcl-ledger-prop-');
    previousStateHome = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = tempDir('gcl-ledger-prop-state-');
    writeFileSync(join(workspace, 'NOTAS.md'), 'notas\n', 'utf8');
  });

  afterEach(() => {
    if (previousStateHome === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = previousStateHome;
  });

  it('la revision la marca como ya completada', () => {
    writeProposal('mision-ledger', {
      candidateId: 'propuesta:1',
      objective: HECHO,
      whyNow: 'porque si',
      evidenceRefs: ['NOTAS.md'],
      doneWhen: ['esta hecho'],
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    const completed = completedObjectives(missionFile([{ objective: HECHO }]));
    const verdicts = reviewProposals('mision-ledger', workspace, completed);

    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]?.defect).toBe('ya-completado');
  });

  it('la fuente de propuestas no la ofrece', async () => {
    writeProposal('mision-ledger', {
      candidateId: 'propuesta:1',
      objective: HECHO,
      whyNow: 'porque si',
      evidenceRefs: ['NOTAS.md'],
      doneWhen: ['esta hecho'],
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    writeProposal('mision-ledger', {
      candidateId: 'propuesta:2',
      objective: PENDIENTE,
      whyNow: 'porque si',
      evidenceRefs: ['NOTAS.md'],
      doneWhen: ['esta hecho'],
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    const completed = completedObjectives(missionFile([{ objective: HECHO }]));
    const port = new ProposalCandidatePort(workspace, completed);
    const candidates = await port.discover({ missionId: 'mision-ledger' });

    expect(candidates.map((c) => c.objective)).toEqual([PENDIENTE]);
  });
});
