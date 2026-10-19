/**
 * Adaptador contra el host ACP.
 *
 * El supervisor es dueno de un unico host y de una unica sesion. Si el host
 * muere, el adaptador lo vuelve a levantar y reanuda la misma sesion, de modo
 * que el estado del Goal se recupera desde el propio runtime.
 *
 * El adaptador falla cerrado: si el host no anuncia los metodos de Goal, no
 * hay integracion posible y se lanza `IncompatibleHostError` en vez de
 * fingir que el trabajo se esta haciendo.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import { ClientSideConnection, ndJsonStream, type Client, type Agent } from '@agentclientprotocol/sdk';
import { IncompatibleHostError, type GoalPort, type Logger } from '../ports.js';
import type { GoalState } from '../core/types.js';

const EXTENSION_META = {
  'minimax-code/extensions': { version: 1, notifications: true },
} as const;

const GOAL_METHODS = [
  'mcode/session/goal/get',
  'mcode/session/goal/create',
  'mcode/session/goal/patch',
  'mcode/session/goal/clear',
] as const;

export interface GoalUpdateEvent {
  sessionId: string;
  goal: GoalState | null;
  goalId?: string;
}

export interface AcpGoalOptions {
  /** Ruta del ejecutable del host. */
  command?: string;
  /** Workspace de la sesion. */
  workspace: string;
  /** Sesion a reanudar; si no se indica, se crea una nueva. */
  sessionId?: string | undefined;
  /** Callback de notificaciones de Goal. */
  onGoalUpdate?: (event: GoalUpdateEvent) => void;
  /** Callback de cualquier notificacion, para trazas. */
  onNotification?: (method: string, params: unknown) => void;
  logger: Logger;
  /** Entorno extra para el host. */
  env?: NodeJS.ProcessEnv;
}

/** Cliente ACP de un solo host, dueno unico de la creacion de Goals. */
export class AcpGoalAdapter implements GoalPort {
  private child: ChildProcessWithoutNullStreams | undefined;
  private conn: ClientSideConnection | undefined;
  private activeSessionId: string | undefined;
  private readonly options: AcpGoalOptions;
  private closed = false;
  private connecting: Promise<void> | null = null;
  private capturing = false;
  private capturedText = '';

  constructor(options: AcpGoalOptions) {
    this.options = options;
  }

  /** Arranca el host y completa el handshake. */
  async start(): Promise<void> {
    await this.connect();
  }

  /** Reconecta si el host dejo de estar vivo, y reanuda la sesion. */
  async ensureHost(): Promise<void> {
    if (this.closed) throw new Error('el adaptador ACP esta cerrado');
    if (this.child && this.child.exitCode === null) return;
    this.options.logger.warn('el host ACP no sigue vivo: se reconecta y se reanuda la sesion');
    await this.connect();
  }

  private async connect(): Promise<void> {
    if (this.connecting) return this.connecting;
    this.connecting = this.doConnect().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async doConnect(): Promise<void> {
    const command = this.options.command ?? 'mcode';
    this.options.logger.info(`arrancando host ACP: ${command} acp (cwd=${this.options.workspace})`);

    const child = spawn(command, ['acp'], {
      cwd: this.options.workspace,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...this.options.env },
    });
    this.child = child;

    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) this.options.logger.info(`[host] ${text.slice(0, 500)}`);
    });
    child.on('exit', (code, signal) => {
      if (!this.closed) {
        this.options.logger.error(`el host ACP termino (code=${code} signal=${signal})`);
      }
    });

    const output = Writable.toWeb(child.stdin) as WritableStream<Uint8Array>;
    const input = Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>;

    const toClient = (_agent: Agent): Client => ({
      sessionUpdate: async (params) => {
        this.capture(params);
      },
      requestPermission: async () => ({ outcome: { outcome: 'cancelled' } }),
      extNotification: async (method: string, params: Record<string, unknown>) => {
        this.options.onNotification?.(method, params);
        if (method !== 'mcode/session/goal_update') return;
        const payload = params as { sessionId: string; goal: GoalState | null; goalId?: string };
        this.options.onGoalUpdate?.({
          sessionId: payload.sessionId,
          goal: payload.goal,
          ...(payload.goalId !== undefined ? { goalId: payload.goalId } : {}),
        });
      },
    });

    const conn = new ClientSideConnection(toClient, ndJsonStream(output, input));
    this.conn = conn;

    const init = (await conn.initialize({
      protocolVersion: 1,
      clientCapabilities: { _meta: EXTENSION_META },
      clientInfo: { name: 'goal-compass-supervisor', version: '0.3.0' },
    })) as { _meta?: Record<string, unknown> };

    this.assertGoalExtension(init._meta);

    if (this.options.sessionId) {
      await conn.loadSession({
        sessionId: this.options.sessionId,
        cwd: this.options.workspace,
        mcpServers: [],
      });
      this.activeSessionId = this.options.sessionId;
      this.options.logger.info(`sesion reanudada: ${this.activeSessionId}`);
    } else {
      const session = await conn.newSession({ cwd: this.options.workspace, mcpServers: [] });
      this.activeSessionId = session.sessionId;
      this.options.logger.info(`sesion creada: ${this.activeSessionId}`);
    }
  }

  /** Comprueba que el host ofrece la extension de Goal. */
  private assertGoalExtension(meta: Record<string, unknown> | undefined): void {
    const ext = meta?.['minimax-code/extensions'] as
      | { version?: number; methods?: string[]; notifications?: string[] }
      | undefined;

    if (!ext) {
      throw new IncompatibleHostError(
        'el host no anuncio la extension de Goal: no es posible encadenar Goals',
      );
    }
    const announced = new Set(ext.methods ?? []);
    const missing = GOAL_METHODS.filter((method) => !announced.has(method));
    if (missing.length > 0) {
      throw new IncompatibleHostError(
        `el host no ofrece los metodos de Goal: ${missing.join(', ')}. ` +
          'La funcion de Goal puede estar deshabilitada en el runtime.',
      );
    }
    if (!(ext.notifications ?? []).includes('mcode/session/goal_update')) {
      this.options.logger.warn(
        'el host no anuncia la notificacion de Goal: el progreso se detectara por sondeo',
      );
    }
    this.options.logger.info('extension de Goal verificada en el host');
  }

  sessionId(): string {
    if (!this.activeSessionId) throw new Error('la sesion ACP no esta iniciada');
    return this.activeSessionId;
  }

  /**
   * Hace una pregunta al agente de la sesion y devuelve su respuesta en texto.
   * Solo se usa con la sesion quieta: si hay un Goal en marcha, sus mensajes
   * se mezclarian con la respuesta.
   */
  async ask(question: string): Promise<string> {
    await this.ensureHost();
    this.capturedText = '';
    this.capturing = true;
    try {
      await this.requireConn().prompt({
        sessionId: this.sessionId(),
        prompt: [{ type: 'text', text: question }],
      });
    } finally {
      this.capturing = false;
    }
    return this.capturedText;
  }

  /** Recoge el texto que el agente va emitiendo mientras se le pregunta. */
  private capture(params: { update?: unknown }): void {
    if (!this.capturing) return;
    const update = params.update as
      | { sessionUpdate?: string; content?: { type?: string; text?: string } }
      | undefined;
    if (update?.sessionUpdate !== 'agent_message_chunk') return;
    if (update.content?.type !== 'text') return;
    this.capturedText += update.content.text ?? '';
  }

  async read(sessionId: string): Promise<GoalState | null> {
    await this.ensureHost();
    const result = (await this.requireConn().extMethod('mcode/session/goal/get', { sessionId })) as {
      goal: GoalState | null;
    };
    return result.goal ?? null;
  }

  async create(
    sessionId: string,
    objective: string,
    tokenBudget: number | undefined,
  ): Promise<GoalState> {
    await this.ensureHost();
    const params: Record<string, unknown> = { sessionId, objective };
    if (tokenBudget !== undefined) params.tokenBudget = tokenBudget;
    const result = (await this.requireConn().extMethod('mcode/session/goal/create', params)) as {
      goal: GoalState;
    };
    return result.goal;
  }

  async pause(sessionId: string): Promise<GoalState | null> {
    return this.setStatus(sessionId, 'paused');
  }

  async resume(sessionId: string): Promise<GoalState | null> {
    return this.setStatus(sessionId, 'active');
  }

  private async setStatus(sessionId: string, status: 'paused' | 'active'): Promise<GoalState | null> {
    await this.ensureHost();
    const result = (await this.requireConn().extMethod('mcode/session/goal/patch', {
      sessionId,
      status,
    })) as { goal: GoalState };
    return result.goal ?? null;
  }

  async clear(sessionId: string): Promise<boolean> {
    await this.ensureHost();
    const result = (await this.requireConn().extMethod('mcode/session/goal/clear', { sessionId })) as {
      cleared: boolean;
    };
    return result.cleared;
  }

  private requireConn(): ClientSideConnection {
    if (!this.conn) throw new Error('el host ACP no esta conectado');
    return this.conn;
  }

  async close(): Promise<void> {
    this.closed = true;
    // El cierre real es terminar el proceso host que poseemos: eso arrastra el
    // stream y con el la conexion.
    const child = this.child;
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (child.exitCode === null) child.kill('SIGKILL');
    }
  }
}
