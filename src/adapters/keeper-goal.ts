/**
 * Adaptador que habla con el proceso vivo en vez de con el host.
 *
 * El supervisor no sabe como se llega al host: solo pide leer y crear
 * objetivos. Este adaptador presenta el mismo puerto y, por debajo, le pide
 * al proceso vivo que lo haga. Asi el camino caro —cargar la sesion en el
 * host— se paga una vez y no en cada turno.
 *
 * Si el proceso vivo no esta, este adaptador falla con un error claro: quien
 * llama decide entonces si abrir un host cold o rendirse.
 */
import { connect, type Socket } from 'node:net';
import type { GoalState } from '../core/types.js';
import type { GoalAdapter, Logger } from '../ports.js';
import type { KeeperRequest, KeeperResponse } from '../plugin/keeper-protocol.js';

/** Margen que espera una peticion al proceso vivo. */
const DEFAULT_REQUEST_TIMEOUT_MS = 7_000;

export interface KeeperGoalOptions {
  /** Sesion del agente. */
  sessionId: string;
  /** Socket donde escucha el proceso vivo. */
  socketPath: string;
  logger: Logger;
  /** Milisegundos que una peticion puede esperar antes de darse por perdida. */
  requestTimeoutMs?: number | undefined;
}

interface Pending {
  resolve: (response: KeeperResponse) => void;
  reject: (error: Error) => void;
}

/** Cliente del proceso vivo. */
export class KeeperGoalAdapter implements GoalAdapter {
  private readonly options: KeeperGoalOptions;
  private socket: Socket | undefined;
  private buffer = '';
  private readonly pending: Pending[] = [];

  constructor(options: KeeperGoalOptions) {
    this.options = options;
  }

  /** Conecta con el proceso vivo. */
  async start(): Promise<void> {
    if (this.socket) return;
    const socketPath = this.options.socketPath;

    await new Promise<void>((resolve, reject) => {
      const socket = connect(socketPath);
      const fail = (err: Error): void => {
        socket.destroy();
        reject(err);
      };
      socket.once('error', fail);
      socket.once('connect', () => {
        socket.removeListener('error', fail);
        socket.setEncoding('utf8');
        socket.on('data', (chunk: string) => this.consume(chunk));
        socket.on('error', () => {
          // El proceso vivo se fue: las peticiones en vuelo no tienen respuesta.
          this.failAll(new Error('el proceso vivo se ha cerrado'));
        });
        this.socket = socket;
        resolve();
      });
    });
  }

  /** Parte la respuesta en mensajes completos. */
  private consume(chunk: string): void {
    this.buffer += chunk;
    let index = this.buffer.indexOf('\n');
    while (index !== -1) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (line) this.resolveOne(line);
      index = this.buffer.indexOf('\n');
    }
  }

  /** Entrega la respuesta a quien la estaba esperando. */
  private resolveOne(line: string): void {
    let parsed: KeeperResponse;
    try {
      parsed = JSON.parse(line) as KeeperResponse;
    } catch {
      parsed = { ok: false, error: 'respuesta que no se entiende' };
    }
    const waiting = this.pending.shift();
    if (waiting) waiting.resolve(parsed);
  }

  /** Informa a las peticiones en vuelo de que no hay respuesta. */
  private failAll(error: Error): void {
    while (this.pending.length > 0) {
      const waiting = this.pending.shift();
      waiting?.reject(error);
    }
  }

  /** Envia una peticion y espera su respuesta. */
  private async call(request: KeeperRequest): Promise<KeeperResponse> {
    const socket = this.socket;
    if (!socket || socket.destroyed) {
      throw new Error('el proceso vivo no esta conectado');
    }

    const limit = this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    const response = new Promise<KeeperResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.pending.findIndex((entry) => entry.resolve === resolve);
        if (index !== -1) this.pending.splice(index, 1);
        reject(new Error(`el proceso vivo no respondio a ${request.action} en ${limit}ms`));
      }, limit);
      timer.unref?.();

      this.pending.push({
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
    });

    socket.write(`${JSON.stringify(request)}\n`);
    return response;
  }

  /** Le pregunta al proceso vivo si esta listo. */
  async ping(): Promise<boolean> {
    const response = await this.call({ action: 'ping' });
    return response.ok === true;
  }

  /**
   * Pide al proceso vivo que se apague.
   *
   * Es lo que se usa al terminar la sesion: el proceso vivo suelta el host y
   * borra su socket.
   */
  async shutdown(): Promise<void> {
    try {
      await this.call({ action: 'close' });
    } catch {
      // Si el proceso vivo no responde, no hay nada que apagar.
    }
  }

  async read(sessionId: string): Promise<GoalState | null> {
    void sessionId;
    const response = await this.call({ action: 'read' });
    if (!response.ok) throw new Error(response.error ?? 'el proceso vivo no pudo leer el objetivo');
    return response.goal ?? null;
  }

  async create(
    sessionId: string,
    objective: string,
    tokenBudget: number | undefined,
  ): Promise<GoalState> {
    void sessionId;
    const request: KeeperRequest = { action: 'create', objective };
    if (tokenBudget !== undefined) request.tokenBudget = tokenBudget;
    const response = await this.call(request);
    if (!response.ok) throw new Error(response.error ?? 'el proceso vivo no pudo crear el objetivo');
    if (!response.goal) throw new Error('el proceso vivo no devolvio el objetivo creado');
    return response.goal;
  }

  async pause(sessionId: string): Promise<GoalState | null> {
    void sessionId;
    const response = await this.call({ action: 'pause' });
    if (!response.ok) throw new Error(response.error ?? 'el proceso vivo no pudo pausar el objetivo');
    return response.goal ?? null;
  }

  async resume(sessionId: string): Promise<GoalState | null> {
    void sessionId;
    const response = await this.call({ action: 'resume' });
    if (!response.ok) throw new Error(response.error ?? 'el proceso vivo no pudo reanudar el objetivo');
    return response.goal ?? null;
  }

  async clear(sessionId: string): Promise<boolean> {
    void sessionId;
    const response = await this.call({ action: 'clear' });
    if (!response.ok) throw new Error(response.error ?? 'el proceso vivo no pudo vaciar el objetivo');
    return response.cleared === true;
  }

  sessionId(): string {
    return this.options.sessionId;
  }

  /**
   * Preguntar al agente no se puede desde aqui.
   *
   * La exploracion la hace el agente, no el hook: el proceso vivo solo sabe
   * de objetivos.
   */
  async ask(): Promise<string> {
    throw new Error('el proceso vivo no puede preguntar al agente');
  }

  /** Cierra la conexion con el proceso vivo, que sigue sirviendo a otros. */
  async close(): Promise<void> {
    const socket = this.socket;
    this.socket = undefined;
    this.failAll(new Error('el proceso vivo se ha cerrado'));
    if (!socket) return;
    socket.end();
    await new Promise<void>((resolve) => {
      socket.once('close', () => resolve());
      setTimeout(resolve, 200).unref?.();
    });
  }
}
