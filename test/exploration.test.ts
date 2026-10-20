import { describe, expect, it, afterEach } from 'vitest';
import { cleanupTempDirs, tempDir } from './support/temp.js';

afterEach(cleanupTempDirs);
import { mkdirSync, writeFileSync } from 'node:fs';


import { join } from 'node:path';
import { SessionExploration } from '../src/adapters/exploration.js';
import { aMission } from './support/harness.js';
import type { TextSession } from '../src/ports.js';

function workspaceWithFile(name: string): string {
  const root = tempDir('gcl-expl-');
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, name), 'contenido');
  return root;
}

/** Sesion que responde siempre lo mismo. */
function answering(text: string): TextSession {
  return { ask: async () => text };
}

describe('SessionExploration · propuestas con evidencia real', () => {
  it('acepta una propuesta cuya evidencia senala a un fichero existente', async () => {
    const workspace = workspaceWithFile('src/tarea.ts');
    const answer = JSON.stringify([
      {
        objective: 'Completar la funcion pendiente de src/tarea.ts',
        whyNow: 'El modulo esta a medio hacer',
        evidenceRefs: ['src/tarea.ts'],
        doneWhen: ['La funcion esta implementada'],
        scope: 'src',
        risk: 'low',
        priority: 5,
      },
    ]);

    const candidates = await new SessionExploration(answering(answer), workspace).explore(
      aMission({ workspace }),
      null,
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.objective).toContain('src/tarea.ts');
    expect(candidates[0]?.source).toBe('investigation');
  });

  it('descarta una propuesta cuya evidencia no senala a nada real', async () => {
    const workspace = workspaceWithFile('src/tarea.ts');
    const answer = JSON.stringify([
      {
        objective: 'Tarea inventada sobre un fichero que no existe',
        evidenceRefs: ['src/inexistente.ts'],
        doneWhen: ['Algo'],
        risk: 'low',
        priority: 1,
      },
    ]);

    const candidates = await new SessionExploration(answering(answer), workspace).explore(
      aMission({ workspace }),
      null,
    );

    expect(candidates).toHaveLength(0);
  });

  it('descarta una propuesta sin criterio de cierre', async () => {
    const workspace = workspaceWithFile('src/tarea.ts');
    const answer = JSON.stringify([
      {
        objective: 'Tarea sin criterio de cierre',
        evidenceRefs: ['src/tarea.ts'],
        doneWhen: [],
        risk: 'low',
        priority: 1,
      },
    ]);

    const candidates = await new SessionExploration(answering(answer), workspace).explore(
      aMission({ workspace }),
      null,
    );

    expect(candidates).toHaveLength(0);
  });

  it('descarta una propuesta cuya evidencia sale del workspace', async () => {
    const workspace = workspaceWithFile('src/tarea.ts');
    const answer = JSON.stringify([
      {
        objective: 'Tarea fuera del workspace',
        evidenceRefs: ['/etc/passwd'],
        doneWhen: ['Algo'],
        risk: 'low',
        priority: 1,
      },
    ]);

    const candidates = await new SessionExploration(answering(answer), workspace).explore(
      aMission({ workspace }),
      null,
    );

    expect(candidates).toHaveLength(0);
  });

  it('aguanta una respuesta que no es JSON', async () => {
    const workspace = workspaceWithFile('src/tarea.ts');

    const candidates = await new SessionExploration(
      answering('No encuentro trabajo pendiente.'),
      workspace,
    ).explore(aMission({ workspace }), null);

    expect(candidates).toHaveLength(0);
  });

  it('encuentra el array aunque la respuesta venga envuelta en texto', async () => {
    const workspace = workspaceWithFile('src/tarea.ts');
    const answer = [
      'He revisado el repositorio. Estas son las propuestas:',
      JSON.stringify([
        {
          objective: 'Arreglar el modulo de src/tarea.ts',
          evidenceRefs: ['src/tarea.ts'],
          doneWhen: ['El modulo funciona'],
          risk: 'low',
          priority: 3,
        },
      ]),
      'Fin de la revision.',
    ].join('\n');

    const candidates = await new SessionExploration(answering(answer), workspace).explore(
      aMission({ workspace }),
      null,
    );

    expect(candidates).toHaveLength(1);
  });
});
