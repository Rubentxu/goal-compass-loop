/**
 * Transporte ACP contra un host real de mentira.
 *
 * El host es un proceso aparte que habla NDJSON, igual que el host de
 * verdad. Asi lo que se comprueba aqui es el transporte: el troceado de los
 * mensajes, el emparejamiento de respuestas, el ida y vuelta de peticiones y
 * la forma de los errores.
 */
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { AcpRequestError, AcpTransport } from '../src/adapters/acp-transport.js';
import type { Logger } from '../src/ports.js';

const HOST_SCRIPT = fileURLToPath(new URL('./support/fake-acp-host.mjs', import.meta.url));

const quietLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

async function withTransport(
  run: (transport: AcpTransport) => Promise<void>,
  env: Record<string, string> = {},
): Promise<void> {
  const transport = new AcpTransport({
    command: process.execPath,
    args: [HOST_SCRIPT],
    cwd: process.cwd(),
    logger: quietLogger,
    env,
  });
  await transport.start();
  try {
    await run(transport);
  } finally {
    await transport.close();
  }
}

describe('transporte ACP', () => {
  it('empareja cada respuesta con su peticion', async () => {
    await withTransport(async (transport) => {
      const first = transport.request<{ sessionId: string }>('session/new', { cwd: '/tmp' });
      const second = transport.request<{ sessionId: string }>('session/new', { cwd: '/tmp' });
      const [a, b] = await Promise.all([first, second]);
      expect(a.sessionId).toBe('mvs_fake');
      expect(b.sessionId).toBe('mvs_fake');
    });
  });

  it('rearmal un mensaje que llega partido en varios trozos', async () => {
    const received: unknown[] = [];
    const transport = new AcpTransport({
      command: process.execPath,
      args: [HOST_SCRIPT],
      cwd: process.cwd(),
      logger: quietLogger,
      onNotification: (method, params) => {
        if (method === 'session/update') received.push(params);
      },
    });
    await transport.start();
    try {
      await transport.request('session/new', { cwd: '/tmp' });
      expect(received).toHaveLength(1);
      const payload = (received[0] as { payload: string }).payload;
      expect(payload.length).toBe(200_000);
    } finally {
      await transport.close();
    }
  });

  it('contesta a las peticiones que hace el host', async () => {
    const answered: string[] = [];
    const transport = new AcpTransport({
      command: process.execPath,
      args: [HOST_SCRIPT],
      cwd: process.cwd(),
      logger: quietLogger,
      onRequest: async (method) => {
        answered.push(method);
        return { outcome: { outcome: 'cancelled' } };
      },
    });
    await transport.start();
    try {
      await transport.request('initialize', { protocolVersion: 1 });
      // El host pregunta al.initialize; se responde antes de la siguiente peticion.
      await transport.request('session/new', { cwd: '/tmp' });
      expect(answered).toContain('session/request_permission');
    } finally {
      await transport.close();
    }
  });

  it('levanta un error tipado cuando el host rechaza la peticion', async () => {
    await withTransport(
      async (transport) => {
        await expect(
          transport.request('mcode/session/goal/get', { sessionId: 's1' }),
        ).rejects.toBeInstanceOf(AcpRequestError);
      },
      { FAKE_ACP_FAIL: 'mcode/session/goal/get' },
    );
  });

  it('propaga el mensaje del host en el error', async () => {
    await withTransport(
      async (transport) => {
        await expect(
          transport.request('mcode/session/goal/get', { sessionId: 's1' }),
        ).rejects.toThrow('fallo preparado');
      },
      { FAKE_ACP_FAIL: 'mcode/session/goal/get' },
    );
  });

  it('deja las peticiones en vuelo sin respuesta cuando el host se cae', async () => {
    const transport = new AcpTransport({
      command: process.execPath,
      args: [HOST_SCRIPT],
      cwd: process.cwd(),
      logger: quietLogger,
    });
    await transport.start();
    await expect(transport.request('session/load', { sessionId: 'x' })).resolves.toBeTruthy();
    await transport.close();
    await expect(transport.request('session/new', { cwd: '/tmp' })).rejects.toThrow();
  });
});
