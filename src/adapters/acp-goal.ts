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
import { AcpTransport } from './acp-transport.js';
import { IncompatibleHostError, type GoalAdapter, type Logger } from '../ports.js';
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

/** Margen para preguntar al agente: puede ser trabajo de verdad. */
const ASK_TIMEOUT_MS = 10 * 60_000;

export interface GoalUpdateEvent {
  sessionId: string;
  goal: GoalState | null;
  goalId?: string;
}

export interface AcpGoalOptions {
  /** Ruta del ejecutable del host. */
  command?: string;
  /** Argumentos del ejecutable del host. */
  args?: string[];
  /** Workspace de la sesion. */
  workspace: string;
  /** Sesion a reanudar; si no se indica, se crea una nueva. */
  sessionId?: string | undefined;
  /** Milisegundos que una peticion puede esperar antes de darse por perdida. */
  requestTimeoutMs?: number;
  /** Margen para cargar la sesion, si se quiere distinto del general. */
  loadTimeoutMs?: number;
  /** Callback de notificaciones de Goal. */
  onGoalUpdate?: (event: GoalUpdateEvent) => void;
  /** Callback de cualquier notificacion, para trazas. */
  onNotification?: (method: string, params: unknown) => void;
  logger: Logger;
  /** Entorno extra para el host. */
  env?: NodeJS.ProcessEnv;
}

/** Cliente ACP de un solo host, dueno unico de la creacion de Goals. */
export class AcpGoalAdapter implements GoalAdapter {
  private transport: AcpTransport | undefined;
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
    if (this.transport?.isAlive()) return;
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
    const transport = new AcpTransport({
      command: this.options.command,
      args: this.options.args ?? ['acp'],
      cwd: this.options.workspace,
      env: this.options.env,
      logger: this.options.logger,
      ...(this.options.requestTimeoutMs !== undefined
        ? { requestTimeoutMs: this.options.requestTimeoutMs }
        : {}),
      onNotification: (method, params) => this.onNotification(method, params),
      onRequest: async (method, params) => this.onRequest(method, params),
    });
    this.transport = transport;
    await transport.start();

    const init = (await transport.request<{ _meta?: Record<string, unknown> }>('initialize', {
      protocolVersion: 1,
      clientCapabilities: { _meta: EXTENSION_META },
      clientInfo: { name: 'goal-compass-supervisor', version: '1' },
    })) ?? {};

    this.assertGoalExtension(init._meta);

    if (this.options.sessionId) {
      // Cargar la sesion lleva su propio margen: es la operacion cara, la que
      // crece con el historial, y la unica que puede no caber. Mezclarla con el
      // resto impediria ajustarla sin arrastrar a las demas.
      await transport.request(
        'session/load',
        {
          sessionId: this.options.sessionId,
          cwd: this.options.workspace,
          mcpServers: [],
        },
        this.options.loadTimeoutMs,
      );
      this.activeSessionId = this.options.sessionId;
      this.options.logger.info(`sesion reanudada: ${this.activeSessionId}`);
    } else {
      const session = await transport.request<{ sessionId: string }>('session/new', {
        cwd: this.options.workspace,
        mcpServers: [],
      });
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
   *
   * Preguntar al agente es trabajo de verdad: puede tardar minutos. Por eso
   * esta peticion lleva su propio margen, mas largo que el del resto.
   */
  async ask(question: string): Promise<string> {
    await this.ensureHost();
    this.capturedText = '';
    this.capturing = true;
    try {
      await this.requireTransport().request(
        'session/prompt',
        {
          sessionId: this.sessionId(),
          prompt: [{ type: 'text', text: question }],
        },
        ASK_TIMEOUT_MS,
      );
    } finally {
      this.capturing = false;
    }
    return this.capturedText;
  }

  /** Atiende las notificaciones del host. */
  private onNotification(method: string, params: unknown): void {
    if (method === 'session/update') {
      this.capture(params);
      return;
    }
    this.options.onNotification?.(method, params);
    if (method !== 'mcode/session/goal_update') return;
    const payload = params as { sessionId: string; goal: GoalState | null; goalId?: string };
    this.options.onGoalUpdate?.({
      sessionId: payload.sessionId,
      goal: payload.goal,
      ...(payload.goalId !== undefined ? { goalId: payload.goalId } : {}),
    });
  }

  /** Responde a las peticiones del host. */
  private async onRequest(method: string, params: unknown): Promise<unknown> {
    if (method === 'session/request_permission') {
      return { outcome: { outcome: 'cancelled' } };
    }
    this.options.logger.warn(`peticion del host sin respuesta: ${method}`);
    void params;
    throw new Error(`metodo no soportado: ${method}`);
  }

  /** Recoge el texto que el agente va emitiendo mientras se le pregunta. */
  private capture(params: unknown): void {
    if (!this.capturing) return;
    const update = (params as { update?: unknown } | null)?.update as
      | { sessionUpdate?: string; content?: { type?: string; text?: string } }
      | undefined;
    if (update?.sessionUpdate !== 'agent_message_chunk') return;
    if (update.content?.type !== 'text') return;
    this.capturedText += update.content.text ?? '';
  }

  async read(sessionId: string): Promise<GoalState | null> {
    await this.ensureHost();
    const result = await this.requireTransport().request<{ goal: GoalState | null }>(
      'mcode/session/goal/get',
      { sessionId },
    );
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
    const result = await this.requireTransport().request<{ goal: GoalState }>(
      'mcode/session/goal/create',
      params,
    );
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
    const result = await this.requireTransport().request<{ goal: GoalState }>(
      'mcode/session/goal/patch',
      { sessionId, status },
    );
    return result.goal ?? null;
  }

  async clear(sessionId: string): Promise<boolean> {
    await this.ensureHost();
    const result = await this.requireTransport().request<{ cleared: boolean }>(
      'mcode/session/goal/clear',
      { sessionId },
    );
    return result.cleared;
  }

  private requireTransport(): AcpTransport {
    if (!this.transport) throw new Error('el host ACP no esta conectado');
    return this.transport;
  }

  async close(): Promise<void> {
    this.closed = true;
    // El cierre real es terminar el proceso host que poseemos: eso arrastra el
    // stream y con el la conexion.
    await this.transport?.close();
  }
}
