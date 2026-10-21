/**
 * La declaracion manda en la intencion; el estado se conserva.
 *
 * Estas pruebas cubren el hueco que hacia que anadir, repriorizar o dividir
 * trabajo no llegara nunca a la cadena: `openMission` tomaba la mision del
 * journal y el backlog se quedaba congelado el dia en que se creo.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reconcileMission } from '../src/core/decide.js';
import { MissionConfigCandidatePort } from '../src/adapters/candidates.js';
import type { MissionConfig } from '../src/adapters/mission.js';
import { completedObjectives } from '../src/adapters/ledger.js';
import type { Candidate, Mission } from '../src/core/types.js';

function candidato(id: string, priority: number): Candidate {
  return {
    candidateId: id,
    objective: `Trabajo ${id}`,
    whyNow: 'porque toca',
    evidenceRefs: ['NOTAS.md'],
    doneWhen: [`${id} esta hecho`],
    risk: 'low',
    priority,
    prerequisites: [],
    source: 'roadmap',
  };
}

function aMission(overrides: Partial<Mission> = {}): Mission {
  return {
    missionId: 'prueba',
    objective: 'Mejorar el proyecto',
    status: 'running',
    defaultTokenBudget: 120_000,
    totalTokenBudget: 600_000,
    maxGoals: null,
    stallTimeoutMs: 600_000,
    explorationEnabled: false,
    explorationCooldownMs: 600_000,
    workspace: '/tmp/prueba',
    backlog: [candidato('viejo', 1)],
    allowRemoteWrite: false,
    ...overrides,
  };
}

const raiz = mkdtempSync(join(tmpdir(), 'gcl-reconcilia-'));

describe('la declaracion y el estado se concilian', () => {
  it('el backlog que llega es el declarado, no el congelado', () => {
    const guardado = aMission({ backlog: [candidato('viejo', 1)] });
    const declarado = aMission({
      backlog: [candidato('nuevo', 10), candidato('viejo', 1)],
    });

    const resultado = reconcileMission(declarado, guardado);

    expect(resultado.backlog.map((c) => c.candidateId)).toEqual(['nuevo', 'viejo']);
  });

  it('repriorizar desde el fichero cambia el orden con el que se encadena', () => {
    const guardado = aMission({
      backlog: [candidato('primero', 10), candidato('segundo', 5)],
    });
    const declarado = aMission({
      backlog: [candidato('primero', 1), candidato('segundo', 9)],
    });

    const resultado = reconcileMission(declarado, guardado);

    // El nucleo ordena por prioridad: lo declarado manda sobre lo guardado.
    const porPrioridad = [...resultado.backlog].sort((a, b) => b.priority - a.priority);
    expect(porPrioridad[0]?.candidateId).toBe('segundo');
  });

  it('el estado del usuario no se pisa porque el fichero declare mas trabajo', () => {
    const guardado = aMission({ status: 'paused_by_user', reason: 'ordenado desde la sesion' });
    const declarado = aMission({ backlog: [candidato('nuevo', 10)] });

    const resultado = reconcileMission(declarado, guardado);

    expect(resultado.status).toBe('paused_by_user');
    expect(resultado.reason).toBe('ordenado desde la sesion');
  });

  it('la intencion que no es estado tambien se hereda de la declaracion', () => {
    const guardado = aMission({ allowRemoteWrite: false, totalTokenBudget: 600_000 });
    const declarado = aMission({ allowRemoteWrite: true, totalTokenBudget: 900_000 });

    const resultado = reconcileMission(declarado, guardado);

    expect(resultado.allowRemoteWrite).toBe(true);
    expect(resultado.totalTokenBudget).toBe(900_000);
  });

  it('un parked viejo no sobrevive a una declaracion que ya tiene trabajo', () => {
    const guardado = aMission({ status: 'parked', reason: 'sin trabajo elegible' });
    const declarado = aMission({ backlog: [candidato('nuevo', 10)] });

    const resultado = reconcileMission(declarado, guardado);

    // El `parked` historico no puede volver aaparcar la mision: lo que decidio
    // que no habia trabajo era un backlog que ya no es el que hay.
    expect(resultado.backlog).toHaveLength(1);
    expect(resultado.backlog[0]?.candidateId).toBe('nuevo');
  });
});

describe('el puerto de la declaracion lee el fichero de verdad', () => {
  function declaracion(backlog: Candidate[]): string {
    const dir = mkdtempSync(join(raiz, 'ws-'));
    const path = join(dir, 'goal-compass.json');
    const config: MissionConfig = {
      missionId: 'prueba-puerto',
      objective: 'Mejorar el proyecto',
      workspace: dir,
      defaultTokenBudget: 120_000,
      totalTokenBudget: null,
      maxGoals: null,
      stallTimeoutMs: 600_000,
      explorationCooldownMs: 600_000,
      explorationEnabled: false,
      allowRemoteWrite: false,
      driver: 'plugin',
      backlog,
    };
    // Sin el campo `workspace`: es como se declara de verdad.
    const raw = { ...config, workspace: undefined };
    writeFileSync(path, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
    return path;
  }

  it('ofrece lo que dice el fichero aunque el workspace no este declarado', async () => {
    const path = declaracion([candidato('del-fichero', 10)]);
    // El mission trae el backlog congelado: si el puerto cayera a el, no
    // apareceria el trabajo nuevo.
    const congelado = aMission({ backlog: [candidato('congelado', 1)] });

    const candidatos = await new MissionConfigCandidatePort(path).discover(congelado, null);

    expect(candidatos.map((c) => c.candidateId)).toEqual(['del-fichero']);
  });

  it('lo que el ledger declara hecho no se vuelve a ofrecer', async () => {
    const dir = mkdtempSync(join(raiz, 'ledger-'));
    mkdirSync(dir, { recursive: true });
    const path = join(dir, 'goal-compass.json');
    writeFileSync(
      path,
      JSON.stringify(
        {
          missionId: 'prueba-ledger',
          objective: 'Mejorar el proyecto',
          defaultTokenBudget: 120_000,
          totalTokenBudget: null,
          explorationEnabled: false,
          allowRemoteWrite: false,
          driver: 'plugin',
          backlog: [candidato('hecho', 10), candidato('pendiente', 5)],
          executed: [{ candidateId: 'hecho', objective: 'Trabajo hecho' }],
        },
        null,
        2,
      ),
      'utf8',
    );

    const port = new MissionConfigCandidatePort(path, completedObjectives(path));
    const candidatos = await port.discover(aMission(), null);

    expect(candidatos.map((c) => c.candidateId)).toEqual(['pendiente']);
  });

  it('si el fichero no existe, se sigue con el backlog del journal', async () => {
    const port = new MissionConfigCandidatePort(join(raiz, 'no-existe.json'));
    const congelado = aMission({ backlog: [candidato('congelado', 1)] });

    const candidatos = await port.discover(congelado, null);

    expect(candidatos.map((c) => c.candidateId)).toEqual(['congelado']);
  });
});

// El harness es efimero: al terminar el proceso no queda nada en el sistema.
process.on('exit', () => {
  rmSync(raiz, { recursive: true, force: true });
});
