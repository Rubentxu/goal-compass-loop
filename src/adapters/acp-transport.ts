/**
 * Transporte ACP: JSON-RPC 2.0 sobre NDJSON, escrito sobre la biblioteca
 * estandar de Node y sin dependencias externas.
 *
 * Por que no se usa un SDK: el supervisor se instala como plugin de MCode, y
 * un plugin se entrega como ficheros que el host ejecuta tal cual. Cuantas
 * menos dependencias tenga el transporte, mas autocontenido es el paquete.
 * El protocolo que hace falta es pequeno —un puñado de metodos y una
 * notificacion— y este fichero lo implementa entero.
 *
 * El reparto de responsabilidades es el siguiente: este modulo transporta
 * mensajes y no sabe nada de Goals. Del estado de un Goal se ocupa el
 * adaptador que lo usa.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { Logger } from '../ports.js';

/** Error devuelto por el host al rechazar una peticion. */
export class AcpRequestError extends Error {
  readonly code: number;
  readonly data: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = 'AcpRequestError';
    this.code = code;
    this.data = data;
  }
}

export interface AcpTransportOptions {
  /** Ruta del ejecutable del host. */
  command?: string;
  /** Argumentos del ejecutable. */
  args?: string[];
  /** Directorio de trabajo del host. */
  cwd: string;
  /** Variables de entorno adicionales. */
  env?: NodeJS.ProcessEnv;
  logger: Logger;
  /**
   * Milisegundos que una peticion puede esperar antes de darse por perdida.
   *
   * Sin este tope, un host que no contesta deja a quien espera bloqueado para
   * siempre: el turno se queda colgado sin que nadie sepa por que.
   */
  requestTimeoutMs?: number;
  /** Notificaciones del host que no son respuestas. */
  onNotification?: (method: string, params: unknown) => void;
  /** Peticiones del host que hay que responder. */
  onRequest?: (method: string, params: unknown) => Promise<unknown>;
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

/** Tope de espera de una peticion al host. */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/**
 * Conexion con un host ACP sobre la entrada y salida estandar de un proceso.
 *
 * Solo hay una conexion por proceso: es el dueno exclusivo de su sesion, y su
 * cierre es terminar el proceso que lo sostiene.
 */
export class AcpTransport {
  private readonly options: AcpTransportOptions;
  private child: ChildProcessWithoutNullStreams | undefined;
  private nextId = 1;
  private readonly pending = new Map<number, PendingCall>();
  private buffer = '';
  private closed = false;

  constructor(options: AcpTransportOptions) {
    this.options = options;
  }

  /** Arranca el proceso del host. */
  async start(): Promise<void> {
    const command = this.options.command ?? 'mcode';
    const args = this.options.args ?? ['acp'];
    this.options.logger.info(`arrancando host ACP: ${command} ${args.join(' ')} (cwd=${this.options.cwd})`);

    const child = spawn(command, args, {
      cwd: this.options.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...this.options.env },
    });
    this.child = child;

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.consume(chunk));
    // Escribir en un host que ya se ha cerrado revienta la tuberria: se
    // avisa y se sigue, porque la peticion que se quedo a medias ya tiene
    // su propia cuenta pendiente.
    child.stdin.on('error', (err: Error) => {
      if (!this.closed) {
        this.options.logger.warn(`el host ACP ya no acepta mensajes: ${err.message}`);
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) this.options.logger.info(`[host] ${text.slice(0, 500)}`);
    });
    child.on('exit', (code, signal) => {
      if (!this.closed) {
        this.options.logger.error(`el host ACP termino (code=${code} signal=${signal})`);
      }
      this.rejectAll(new Error('el host ACP se ha cerrado'));
    });
  }

  /** Envia una peticion y espera su respuesta. */
  request<T>(method: string, params: unknown, timeoutMs?: number): Promise<T> {
    const child = this.child;
    if (!child || this.closed) return Promise.reject(new Error('el host ACP no esta conectado'));

    const id = this.nextId++;
    const promise = new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);

    // Una peticion sin respuesta no se puede dejar esperando: se acabaria
    // esperando hasta que el host la corte, y el turno se quedaria colgado.
    // Cada peticion lleva su propio tope: preguntar al agente tarda minutos,
    // pero el apretón de manos del host no puede tardar ni medio minuto.
    const limit = timeoutMs ?? this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    const timer = setTimeout(() => {
      const call = this.pending.get(id);
      if (!call) return;
      this.pending.delete(id);
      this.options.logger.error(
        `el host ACP no respondio a ${method} en ${limit}ms: se sigue sin esa respuesta`,
      );
      call.reject(new Error(`el host ACP no respondio a ${method}`));
    }, limit);
    timer.unref?.();

    return promise.finally(() => clearTimeout(timer)) as Promise<T>;
  }

  /** Envia una notificacion: no espera respuesta. */
  notify(method: string, params: unknown): void {
    const child = this.child;
    if (!child || this.closed) return;
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  /** Indica si el proceso del host sigue vivo. */
  isAlive(): boolean {
    return this.child !== undefined && this.child.exitCode === null;
  }

  /** Termina el proceso del host y cierra la conexion. */
  async close(): Promise<void> {
    this.closed = true;
    this.rejectAll(new Error('el host ACP esta cerrado'));
    const child = this.child;
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (child.exitCode === null) child.kill('SIGKILL');
    }
  }

  /** Parte el flujo del host en mensajes completos. */
  private consume(chunk: string): void {
    this.buffer += chunk;
    let index = this.buffer.indexOf('\n');
    while (index !== -1) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (line) this.dispatch(line);
      index = this.buffer.indexOf('\n');
    }
  }

  /** Reparte un mensaje del host: respuesta, peticion o notificacion. */
  private dispatch(line: string): void {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    } catch {
      this.options.logger.warn(`mensaje del host que no es JSON: ${line.slice(0, 200)}`);
      return;
    }

    const id = typeof message.id === 'number' ? message.id : undefined;
    const method = typeof message.method === 'string' ? message.method : undefined;

    if (method !== undefined && id !== undefined) {
      void this.answer(message, method);
      return;
    }
    if (method !== undefined) {
      this.options.onNotification?.(method, message.params ?? null);
      return;
    }
    if (id === undefined) return;

    const call = this.pending.get(id);
    if (!call) return;
    this.pending.delete(id);

    if (message.error !== undefined && message.error !== null) {
      const error = message.error as { code?: number; message?: string; data?: unknown };
      call.reject(new AcpRequestError(error.code ?? -1, error.message ?? 'error desconocido', error.data));
      return;
    }
    call.resolve(message.result ?? null);
  }

  /** Responde a una peticion del host. */
  private async answer(message: Record<string, unknown>, method: string): Promise<void> {
    const child = this.child;
    const id = message.id as number;
    const respond = (result: unknown): void => {
      if (!child || this.closed) return;
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
    };
    const fail = (code: number, text: string): void => {
      if (!child || this.closed) return;
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message: text } })}\n`,
      );
    };

    try {
      const handler = this.options.onRequest;
      if (!handler) {
        fail(-32601, `metodo no soportado: ${method}`);
        return;
      }
      respond(await handler(method, message.params ?? null));
    } catch (error) {
      fail(-32000, String(error).slice(0, 300));
    }
  }

  /** Deshace todas las peticiones en vuelo. */
  private rejectAll(error: Error): void {
    for (const call of this.pending.values()) call.reject(error);
    this.pending.clear();
  }
}
