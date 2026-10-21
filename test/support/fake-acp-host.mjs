/**
 * Host ACP de mentira que habla el protocolo de verdad.
 *
 * Es un proceso real que lee NDJSON por la entrada estandar y contesta por la
 * salida estandar. Asi las pruebas del transporte comprueban el cableado
 * completo: el troceado de mensajes, el emparejamiento de respuestas y la
 * propagacion de errores, no una simulacion de los dos lados a la vez.
 *
 * El guion lo elige el entorno:
 *   FAKE_ACP_FAIL=<metodo>   el metodo responde con error
 *   FAKE_ACP_GOAL=<estado>   estado del Goal que devuelve
 *   FAKE_ACP_SEED_GOAL=<estado>  el host arranca con un Goal ya creado
 *   FAKE_ACP_SEED_ID=<id>       identificador de ese Goal
 *   FAKE_ACP_SEED_BUDGET=<n>    presupuesto de ese Goal
 *   FAKE_ACP_FREEZE_AFTER_MS=<ms>  a partir de ese momento, el host deja de
 *                                   responder a nada: sirve para comprobar que
 *                                   quien pregunta no depende de la respuesta
 */
import { createInterface } from 'node:readline';

const GOAL_METHODS = [
  'mcode/session/goal/get',
  'mcode/session/goal/create',
  'mcode/session/goal/patch',
  'mcode/session/goal/clear',
];

const failMethod = process.env.FAKE_ACP_FAIL ?? '';
const goalStatus = process.env.FAKE_ACP_GOAL ?? 'complete';
const seedStatus = process.env.FAKE_ACP_SEED_GOAL ?? '';
const seedId = process.env.FAKE_ACP_SEED_ID ?? 'tg_fake_1';
const seedBudget = Number(process.env.FAKE_ACP_SEED_BUDGET ?? 0);
const freezeAfterMs = Number(process.env.FAKE_ACP_FREEZE_AFTER_MS ?? 0);
const loadDelayMs = Number(process.env.FAKE_ACP_LOAD_DELAY_MS ?? 0);
const driftAfterMs = Number(process.env.FAKE_ACP_DRIFT_AFTER_MS ?? 0);
const driftStatus = process.env.FAKE_ACP_DRIFT_STATUS ?? 'active';
const startedAt = Date.now();

let counter = 0;
const goals = new Map();

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

/**
 * Deja un objetivo ya creado en la sesion.
 *
 * Sirve para el caso en que la cadena se encuentra un objetivo que ya esta
 * en la sesion: agotado, pausado o activo.
 */
function seedGoal(sessionId) {
  if (!seedStatus) return;
  const goal = {
    goalId: seedId,
    sessionId,
    objective: 'objetivo anterior',
    status: seedStatus,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    tokensUsed: seedBudget,
    turnsUsed: 1,
    timeUsedSeconds: 9,
    tokenBudget: seedBudget,
    statusReason: `${seedStatus}(token_budget_exhausted)`,
    executionWait: null,
    hasKickoffAttachments: false,
  };
  goals.set(sessionId, goal);
  // El objetivo sembrado ocupa el primer identificador: los que se creen
  // despues no pueden repetirlo.
  counter = Math.max(counter, 1);

  // El plazo del cambio cuenta desde que el objetivo existe, para que la
  // prueba sepa que ya ha ocurrido al pedir el siguiente estado.
  if (driftAfterMs > 0) {
    setTimeout(() => driftGoal(sessionId), driftAfterMs);
  }
}

function goal(sessionId, objective, tokenBudget) {
  counter += 1;
  const goalId = `tg_fake_${counter}`;
  const goal = {
    goalId,
    sessionId,
    objective: objective ?? 'objetivo anterior',
    status: goalStatus,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    tokensUsed: 120,
    turnsUsed: 1,
    timeUsedSeconds: 9,
    statusReason: 'complete(verifier_met)',
    executionWait: null,
    hasKickoffAttachments: false,
  };
  if (tokenBudget !== undefined) goal.tokenBudget = tokenBudget;
  goals.set(sessionId, goal);
  return goal;
}

/**
 * Cambia el objetivo por su cuenta y sin avisar.
 *
 * Es lo que pasa cuando alguien reanuda el objetivo desde el host y el aviso
 * de cambio no llega: el objetivo real ya es otro y quien lo tiene guardado
 * sigue con lo que vio la ultima vez.
 */
function driftGoal(sessionId) {
  const current = goals.get(sessionId);
  if (!current) return;
  current.status = driftStatus;
}

const input = createInterface({ input: process.stdin });

input.on('line', (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }

  const { id, method, params } = message;

  // El host se congela: deja de responder y no contesta ni con un error.
  // Quien pregunte tiene que quedarse con lo que ya sabe.
  if (freezeAfterMs > 0 && Date.now() - startedAt > freezeAfterMs) return;

  if (id !== undefined && method === 'session/request_permission') {
    send({ jsonrpc: '2.0', id, result: { outcome: { outcome: 'cancelled' } } });
    return;
  }

  if (method === failMethod) {
    send({ jsonrpc: '2.0', id, error: { code: -32000, message: 'fallo preparado' } });
    return;
  }

  switch (method) {
    case 'initialize':
      send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: 1,
          _meta: {
            'minimax-code/extensions': {
              version: 1,
              methods: [...GOAL_METHODS, 'session/new', 'session/load'],
              notifications: ['mcode/session/goal_update'],
            },
          },
        },
      });
      // El host tambien pregunta: el cliente tiene que saber responder.
      send({ jsonrpc: '2.0', id: 987654, method: 'session/request_permission', params: {} });
      return;
    case 'session/new':
      seedGoal(params.sessionId);
      // Un mensaje grande viaja partido en varios trozos: el receptor tiene
      // que rearmarlo antes de interpretarlo.
      send({
        jsonrpc: '2.0',
        method: 'session/update',
        params: { sessionId: 'mvs_fake', payload: 'x'.repeat(200_000) },
      });
      send({ jsonrpc: '2.0', id, result: { sessionId: 'mvs_fake' } });
      return;
    case 'session/load':
      // Cargar la sesion es lo caro, y su coste crece con el historial. Una
      // sesion grande tarda mas que el margen que se le da, y entonces no es que
      // el host este ocupado: es que la carga no cabe.
      if (loadDelayMs > 0) {
        setTimeout(() => {
          seedGoal(params.sessionId);
          send({ jsonrpc: '2.0', id, result: { modes: { currentModeId: 'default' } } });
        }, loadDelayMs);
        return;
      }
      seedGoal(params.sessionId);
      send({ jsonrpc: '2.0', id, result: { modes: { currentModeId: 'default' } } });
      return;
    case 'mcode/session/goal/get': {
      const current = goals.get(params.sessionId);
      send({ jsonrpc: '2.0', id, result: { goal: current ?? null } });
      return;
    }
    case 'mcode/session/goal/create': {
      const created = goal(params.sessionId, params.objective, params.tokenBudget);
      send({ jsonrpc: '2.0', id, result: { goal: created } });
      return;
    }
    case 'mcode/session/goal/patch': {
      const current = goals.get(params.sessionId) ?? goal(params.sessionId);
      current.status = params.status;
      send({ jsonrpc: '2.0', id, result: { goal: current } });
      return;
    }
    case 'mcode/session/goal/clear': {
      goals.delete(params.sessionId);
      send({ jsonrpc: '2.0', id, result: { cleared: true } });
      return;
    }
    default:
      if (id !== undefined) {
        send({ jsonrpc: '2.0', id, error: { code: -32601, message: `metodo desconocido: ${method}` } });
      }
  }
});
