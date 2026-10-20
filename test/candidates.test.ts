import { describe, expect, it, afterEach } from 'vitest';
import { cleanupTempDirs, tempDir } from './support/temp.js';

afterEach(cleanupTempDirs);
import { writeFileSync } from 'node:fs';


import { join } from 'node:path';
import { MissionConfigCandidatePort } from '../src/adapters/candidates.js';
import { aMission } from './support/harness.js';

function missionFile(backlog: unknown[]): string {
  const directory = tempDir('gcl-mission-');
  const path = join(directory, 'mission.json');
  writeFileSync(
    path,
    JSON.stringify({
      missionId: 'm1',
      objective: 'mision',
      workspace: '/tmp',
      defaultTokenBudget: 100_000,
      totalTokenBudget: null,
      maxGoals: null,
      allowRemoteWrite: false,
      backlog,
    }),
  );
  return path;
}

const aCandidateConfig = {
  candidateId: 'c1',
  objective: 'arreglar el fallo',
  whyNow: 'reproducido',
  evidenceRefs: ['docs/a.md'],
  doneWhen: ['la prueba pasa'],
  risk: 'low',
  priority: 5,
  prerequisites: [],
  source: 'observed',
};

describe('MissionConfigCandidatePort · backlog vivo', () => {
  it('lee el backlog del fichero de mision', async () => {
    const port = new MissionConfigCandidatePort(missionFile([aCandidateConfig]));

    const candidates = await port.discover(aMission(), null);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.candidateId).toBe('c1');
  });

  it('recoge un candidato anadido despues, sin tocar el journal', async () => {
    const path = missionFile([]);
    const port = new MissionConfigCandidatePort(path);

    expect(await port.discover(aMission(), null)).toHaveLength(0);

    writeFileSync(
      path,
      JSON.stringify({
        missionId: 'm1',
        objective: 'mision',
        workspace: '/tmp',
        defaultTokenBudget: 100_000,
        totalTokenBudget: null,
        maxGoals: null,
        allowRemoteWrite: false,
        backlog: [aCandidateConfig],
      }),
    );

    const candidates = await port.discover(aMission(), null);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.candidateId).toBe('c1');
  });

  it('cae al backlog guardado cuando el fichero no se puede leer', async () => {
    const port = new MissionConfigCandidatePort('/no/existe/mission.json');
    const mission = aMission({
      backlog: [
        {
          candidateId: 'c-journal',
          objective: 'desde el journal',
          whyNow: '',
          evidenceRefs: ['x'],
          doneWhen: ['y'],
          risk: 'low',
          priority: 1,
          prerequisites: [],
          source: 'observed',
        },
      ],
    });

    const candidates = await port.discover(mission, null);

    expect(candidates[0]?.candidateId).toBe('c-journal');
  });
});
