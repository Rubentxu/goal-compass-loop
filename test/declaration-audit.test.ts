/**
 * La auditoría de declaraciones y el diagnóstico de la flota.
 *
 * Una declaración puede estar escrita con el vocabulario equivocado y no
 * decir nada: el cargador lee unos campos y solo esos. Aquí se comprueba que
 * la auditoría ve lo que se va a perder, y que el diagnóstico dice cómo están
 * las misiones sin tocar ninguna.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanupTempDirs, tempDir } from './support/temp.js';
import { auditDeclaration, anchorExists } from '../src/adapters/declaration-audit.js';

const quiet = { info: () => {}, warn: () => {}, error: () => {} };

/** Escribe una declaración con lo que se le pase. */
function writeDeclaration(workspace: string, contenido: unknown): string {
  const path = join(workspace, 'goal-compass.json');
  writeFileSync(path, JSON.stringify(contenido, null, 2), 'utf8');
  return path;
}

/** Un candidato con todo lo que el cargador necesita. */
function candidato(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    candidateId: 'trabajo-1',
    objective: 'Arreglar el fichero de notas',
    whyNow: 'Es lo primero que falta',
    evidenceRefs: ['NOTAS.md'],
    doneWhen: ['las notas estan revisadas'],
    risk: 'low',
    priority: 10,
    prerequisites: [],
    source: 'roadmap',
    ...extra,
  };
}

describe('auditoria de una declaracion', () => {
  let workspace: string;

  beforeEach(() => {
    workspace = tempDir('gcl-auditoria-');
  });

  afterEach(() => {
    cleanupTempDirs();
  });

  it('una declaracion en orden no tiene problemas', () => {
    writeFileSync(join(workspace, 'NOTAS.md'), '# notas\n', 'utf8');
    const path = writeDeclaration(workspace, {
      missionId: 'prueba',
      objective: 'Una mision de prueba',
      driver: 'plugin',
      backlog: [candidato()],
    });

    const audit = auditDeclaration(path, { workspace });

    expect(audit.problems).toEqual([]);
    expect(audit.candidates).toBe(1);
    expect(audit.ready).toBe(1);
    expect(audit.discarded).toBe(0);
  });

  it('ve la evidencia escrita en un campo que el cargador no lee', () => {
    // El caso que aparecio en otro proyecto: el campo se llama `evidence`, el
    // valor es una ruta que existe y el autor cree que la ha dejado.
    writeFileSync(join(workspace, 'NOTAS.md'), '# notas\n', 'utf8');
    const path = writeDeclaration(workspace, {
      missionId: 'prueba',
      objective: 'Una mision de prueba',
      driver: 'plugin',
      backlog: [candidato({ evidenceRefs: undefined, evidence: 'NOTAS.md' })],
    });

    const audit = auditDeclaration(path, { workspace });

    const desconocido = audit.problems.find((p) => p.kind === 'campo-desconocido');
    expect(desconocido).toBeDefined();
    expect(desconocido?.candidateId).toBe('trabajo-1');
    expect(desconocido?.hint).toContain('evidenceRefs');

    // Y el candidato queda descartado, que es lo que de verdad pasa.
    expect(audit.discarded).toBe(1);
    expect(audit.problems.some((p) => p.kind === 'sin-evidencia')).toBe(true);
  });

  it('ve el trabajo que el proyecto ya cerro en su roadmap', () => {
    // El backlog puede apuntar a una seccion que el proyecto ya dio por
    // hecha. El selector no lo va a ofrecer, y la auditoria tiene que decirlo
    // para que el backlog no parezca mas grande de lo que es.
    mkdirSync(join(workspace, 'docs'), { recursive: true });
    writeFileSync(
      join(workspace, 'docs', 'roadmap.md'),
      [
        '<a id="cerrado"></a>',
        '',
        '## Trabajo ya hecho',
        '',
        '**Estado:** cerrado (esta parte ya no hace falta)',
        '',
      ].join('\n'),
      'utf8',
    );
    const path = writeDeclaration(workspace, {
      missionId: 'prueba',
      objective: 'Una mision de prueba',
      driver: 'plugin',
      backlog: [candidato({ evidenceRefs: ['docs/roadmap.md#cerrado'] })],
    });

    const audit = auditDeclaration(path, { workspace });
    const cerrada = audit.problems.find((p) => p.kind === 'seccion-cerrada');

    expect(cerrada).toBeDefined();
    expect(cerrada?.candidateId).toBe('trabajo-1');
    expect(audit.discarded).toBe(1);
    expect(audit.ready).toBe(0);
  });

  it('ve una referencia que no apunta a ningun fichero', () => {
    const path = writeDeclaration(workspace, {
      missionId: 'prueba',
      objective: 'Una mision de prueba',
      driver: 'plugin',
      backlog: [candidato({ evidenceRefs: ['NO_EXISTE.md'] })],
    });

    const audit = auditDeclaration(path, { workspace });
    const rota = audit.problems.find((p) => p.kind === 'referencia-rota');

    expect(rota).toBeDefined();
    expect(rota?.detail).toContain('NO_EXISTE.md');
  });

  it('ve una referencia con un ancla que no existe', () => {
    writeFileSync(join(workspace, 'NOTAS.md'), '# notas\n\n<a id="p1"></a>\n', 'utf8');
    const path = writeDeclaration(workspace, {
      missionId: 'prueba',
      objective: 'Una mision de prueba',
      driver: 'plugin',
      backlog: [candidato({ evidenceRefs: ['NOTAS.md#p9'] })],
    });

    const audit = auditDeclaration(path, { workspace });
    const rota = audit.problems.find((p) => p.kind === 'ancla-rota');

    expect(rota).toBeDefined();
    expect(rota?.detail).toContain('p9');
  });

  it('acepta un ancla explicita, un numero de seccion y un titulo', () => {
    const contenido = [
      '<a id="p1"></a>',
      '### 2.2 El manifiesto de invalidacion',
      '## Conclusion final',
    ].join('\n');

    expect(anchorExists(contenido, 'p1')).toBe(true);
    expect(anchorExists(contenido, '2.2')).toBe(true);
    expect(anchorExists(contenido, 'conclusion-final')).toBe(true);
    expect(anchorExists(contenido, 'p9')).toBe(false);
  });

  it('ve una cola escrita al reves', () => {
    writeFileSync(join(workspace, 'NOTAS.md'), '# notas\n', 'utf8');
    const path = writeDeclaration(workspace, {
      missionId: 'prueba',
      objective: 'Una mision de prueba',
      driver: 'plugin',
      backlog: [
        candidato({ candidateId: 'a', priority: 1 }),
        candidato({ candidateId: 'b', priority: 2 }),
        candidato({ candidateId: 'c', priority: 3 }),
      ],
    });

    const audit = auditDeclaration(path, { workspace });
    const invertida = audit.problems.find((p) => p.kind === 'prioridad-invertida');

    expect(invertida).toBeDefined();
    expect(invertida?.hint).toContain('mayor a menor');
  });

  it('no se inventa un problema cuando la cola esta bien escrita', () => {
    writeFileSync(join(workspace, 'NOTAS.md'), '# notas\n', 'utf8');
    const path = writeDeclaration(workspace, {
      missionId: 'prueba',
      objective: 'Una mision de prueba',
      driver: 'plugin',
      backlog: [
        candidato({ candidateId: 'a', priority: 10 }),
        candidato({ candidateId: 'b', priority: 9 }),
        candidato({ candidateId: 'c', priority: 8 }),
      ],
    });

    const audit = auditDeclaration(path, { workspace });
    expect(audit.problems.filter((p) => p.kind === 'prioridad-invertida')).toEqual([]);
  });
});

describe('diagnostico de las misiones', () => {
  let workspace: string;
  let stateHome: string;

  beforeEach(() => {
    workspace = tempDir('gcl-doctor-proyecto-');
    stateHome = tempDir('gcl-doctor-estado-');
  });

  afterEach(() => {
    cleanupTempDirs();
  });

  /** Ejecuta el diagnostico como lo haria una persona. */
  function runDoctor(): Promise<{ code: number | null; out: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        join(process.cwd(), 'node_modules', '.bin', 'tsx'),
        ['src/cli.ts', 'doctor'],
        {
          cwd: process.cwd(),
          env: { ...process.env, XDG_STATE_HOME: stateHome },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );

      let out = '';
      child.stdout.on('data', (chunk: Buffer) => {
        out += chunk.toString();
      });
      child.stderr.on('data', () => {});

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('el diagnostico no termino'));
      }, 30_000);

      child.on('exit', (code) => {
        clearTimeout(timer);
        resolve({ code, out });
      });
    });
  }

  it('dice como esta cada mision sin tocar ninguna', async () => {
    // Una mision con la evidencia en el campo equivocado, y otra que esta bien.
    writeFileSync(join(workspace, 'NOTAS.md'), '# notas\n', 'utf8');
    writeDeclaration(workspace, {
      missionId: 'rota',
      objective: 'Una mision con la evidencia mal escrita',
      driver: 'plugin',
      backlog: [candidato({ evidenceRefs: undefined, evidence: 'NOTAS.md' })],
    });

    const buena = tempDir('gcl-doctor-buena-');
    writeFileSync(join(buena, 'NOTAS.md'), '# notas\n', 'utf8');
    writeDeclaration(buena, {
      missionId: 'buena',
      objective: 'Una mision en orden',
      driver: 'plugin',
      backlog: [candidato()],
    });

    // El estado durable es el que dice que misiones existen.
    for (const [id, ws] of [
      ['rota', workspace],
      ['buena', buena],
    ] as const) {
      const dir = join(stateHome, 'goal-compass', id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'journal.json'),
        JSON.stringify({ missionId: id, mission: { workspace: ws } }, null, 2),
        'utf8',
      );
    }

    const { code, out } = await runDoctor();

    expect(code).toBe(0);
    expect(out).toContain('rota');
    expect(out).toContain('campo-desconocido');
    expect(out).toContain('sin-evidencia');
    expect(out).toContain('buena');
    expect(out).toContain('1 de 2 mision(es) con problemas');
  });

  it('no escribe en el proyecto que audita', async () => {
    writeFileSync(join(workspace, 'NOTAS.md'), '# notas\n', 'utf8');
    const path = writeDeclaration(workspace, {
      missionId: 'rota',
      objective: 'Una mision con la evidencia mal escrita',
      driver: 'plugin',
      backlog: [candidato({ evidenceRefs: undefined, evidence: 'NOTAS.md' })],
    });

    const antes = (await import('node:fs')).readFileSync(path, 'utf8');
    await runDoctor();
    const despues = (await import('node:fs')).readFileSync(path, 'utf8');

    expect(despues).toBe(antes);
  });
});
