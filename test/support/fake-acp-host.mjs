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

let counter = 0;
const goals = new Map();

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function goal(sessionId, objective) {
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
  goals.set(sessionId, goal);
  return goal;
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
      send({ jsonrpc: '2.0', id, result: { modes: { currentModeId: 'default' } } });
      return;
    case 'mcode/session/goal/get': {
      const current = goals.get(params.sessionId);
      send({ jsonrpc: '2.0', id, result: { goal: current ?? null } });
      return;
    }
    case 'mcode/session/goal/create': {
      const created = goal(params.sessionId, params.objective);
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
