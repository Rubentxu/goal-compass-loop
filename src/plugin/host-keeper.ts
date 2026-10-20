/**
 * Proceso que guarda viva la conexion con el host.
 *
 * El hook de continuacion necesita crear un objetivo en la sesion del agente,
 * y el host solo lo permite sobre una sesion que este cargada en el proceso
 * que habla con el. Cargar la sesion es lo caro: hay que leer todo su
 * historial, y ese historial crece con cada turno.
 *
 * Este proceso resuelve el problema quedandose con la sesion cargada: nace
 * cuando la sesion empieza, cuando su historial todavia es pequeno, y se
 * queda despierto hasta que la sesion termina. Despues, crear un objetivo
 * cuesta milisegundos en vez de segundos.
 *
 * El proceso no es un demonio: muere con el host que lo lanzo, y se puede
 * cerrar a mano cuando la sesion se acaba.
 */
import { createServer, type Socket } from 'node:net';
import { mkdirSync, rmSync, realpathSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AcpGoalAdapter } from '../adapters/acp-goal.js';
import type { GoalState } from '../core/types.js';
import { parseKeeperRequest, type KeeperRequest, type KeeperResponse } from './keeper-protocol.js';
import type { Logger } from '../ports.js';

/** Cada cuanto se comprueba que el host que lanzo el proceso sigue vivo. */
const WATCHDOG_INTERVAL_MS = 2_000;

/** Cuantas veces se intenta cargar la sesion antes de rendirse. */
const MAX_ATTEMPTS = 5;

/**
 * Tope de la pregunta al host cuando el proceso vivo todavia no sabe cual es
 * el objetivo.
 *
 * El hook que pregunta corre mientras el host que tiene el objetivo esta
 * ocupado: es el propio hook el que lo espera. Preguntar sin tope es lo que
 * hace que el hook agote su margen y el turno termine sin continuacion.
 */
const GOAL_READ_TIMEOUT_MS = 400;

/** Espera entre intentos de cargar la sesion. */
const RETRY_DELAY_MS = 1_000;

/** Vida maxima del proceso vivo cuando no se sabe quien lo lanzo. */
const MAX_LIFETIME_MS = 6 * 60 * 60_000;

export interface KeeperOptions {
  /** Sesion del agente: la que hay que tener cargada en el host. */
  sessionId: string;
  /** Directorio de trabajo del host. */
  workspace: string;
  /** Socket donde se listens las peticiones. */
  socketPath: string;
  /** Proceso al que pertenece esta sesion: cuando muere, muere el keeper. */
  ownerPid?: number | undefined;
  /** Ejecutable del host y sus argumentos, cuando no es el de por defecto. */
  host?: { command?: string; args?: string[] } | undefined;
  /** Donde se cuenta lo que va pasando. */
  logger?: Logger | undefined;
  /** Fichero donde dejar el rastro, cuando el registro va a un fichero. */
  logPath?: string | undefined;
}

/**
 * Levanta el proceso vivo y no vuelve hasta que termina.
 *
 * El socket se abre antes de tocar el host: si alguien pregunta mientras la
 * sesion se esta cargando, la pregunta espera a que el host este listo en vez
 * de fallar.
 */
export async function runKeeper(options: KeeperOptions): Promise<void> {
  const { sessionId, workspace, socketPath } = options;
  const logger = options.logger ?? fileLogger(options.logPath ?? `${socketPath}.log`);

  let adapter: AcpGoalAdapter | undefined;
  let ready = false;
  let failure: string | undefined;
  /**
   * El ultimo estado del objetivo que se ha visto.
   *
   * `undefined` significa "todavia no se sabe"; `null` significa "no hay
   * objetivo". La distincion importa: decir "no hay" cuando no se sabe puede
   * crear un objetivo que ya existe.
   */
  let cachedGoal: GoalState | null | undefined;

  const build = (): AcpGoalAdapter =>
    new AcpGoalAdapter({
      workspace,
      sessionId,
      logger,
      // El host avisa de cada cambio del objetivo. Ese aviso es lo que
      // permite que el proceso vivo sepa cual es sin preguntar, y preguntar
      // es lo que se queda colgado mientras el host esta ocupado.
      onGoalUpdate: (event) => {
        if (event.sessionId !== sessionId) return;
        cachedGoal = event.goal ?? null;
      },
      ...(options.host?.command !== undefined ? { command: options.host.command } : {}),
      ...(options.host?.args !== undefined ? { args: options.host.args } : {}),
    });

  /**
   * Carga la sesion en el host.
   *
   * Al empezar la sesion puede que todavia no exista en el host, asi que se
   * reintenta unas veces antes de rendirse. Cada intento usa un adaptador
   * nuevo: el anterior, si fallo a medias, se cierra para no dejar procesos
   * sueltos.
   */
  const warm = async (): Promise<void> => {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const candidate = build();
      try {
        await candidate.start();
        adapter = candidate;
        ready = true;
        failure = undefined;
        // Aqui el host esta libre: es el momento de preguntar cual es el
        // objetivo. A partir de aqui manda el aviso de cambio.
        cachedGoal = await candidate.read(sessionId).catch(() => undefined);
        logger.info(`sesion cargada en el proceso vivo: ${sessionId}`);
        return;
      } catch (err) {
        await candidate.close().catch(() => {});
        failure = (err as Error).message;
        // Hay sesiones que el host no deja abrir a nadie: las de subagente.
        // Reintentar no sirve de nada, asi que el proceso vivo se apaga.
        if (isInternalSession(failure)) {
          logger.info(`esta sesion no se puede abrir: el proceso vivo se apaga (${failure})`);
          await shutdown();
          return;
        }
        logger.warn(
          `el proceso vivo no pudo cargar la sesion (intento ${attempt} de ${MAX_ATTEMPTS}): ${failure}`,
        );
        if (attempt < MAX_ATTEMPTS) await delay(RETRY_DELAY_MS);
      }
    }
    // Agotados los intentos, el proceso vivo no puede hacer su trabajo: se
    // apaga y deja que el hook use el camino de reserva.
    logger.info('el proceso vivo no pudo cargar la sesion: se apaga');
    await shutdown();
  };

  /**
   * Apaga el proceso vivo.
   *
   * Se suelta el host y se retira el socket: si el proceso se va dejando el
   * socket en su sitio, el siguiente que lo_encuentre creera que hay alguien
   * escuchando.
   */
  const shutdown = async (): Promise<void> => {
    rmSync(socketPath, { force: true });
    await adapter?.close().catch(() => {});
    process.exit(0);
  };

  const server = createServer((socket) => {
    handleConnection(socket, {
      getAdapter: () => adapter,
      build,
      sessionId,
      logger,
      isReady: () => ready,
      failure: () => failure,
      goal: () => cachedGoal,
      setGoal: (goal: GoalState | null | undefined) => {
        cachedGoal = goal;
      },
      shutdown,
    });
  });

  mkdirSync(dirname(socketPath), { recursive: true });
  // Un socket que se quedo de un proceso anterior estorba: se retira antes de
  // escuchar en el.
  rmSync(socketPath, { force: true });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  logger.info(`proceso vivo escuchando en ${socketPath}`);

  const watchdog = setInterval(() => {
    const owner = options.ownerPid;
    if (owner === undefined) return;
    if (!isAlive(owner)) {
      logger.info('el proceso que lanzo el proceso vivo ya no esta: se apaga');
      clearInterval(watchdog);
      void shutdown();
    }
  }, WATCHDOG_INTERVAL_MS);
  watchdog.unref?.();

  // Red de seguridad: un proceso vivo sin dueno no puede quedarse vivo para
  // siempre. Cuando el dueno del host no se conoce, el proceso se apaga solo
  // pasado un rato.
  const maximo = setTimeout(() => {
    logger.info('el proceso vivo llega al final de su vida: se apaga');
    void shutdown();
  }, MAX_LIFETIME_MS);
  maximo.unref?.();

  const closed = new Promise<void>((resolve) => {
    server.once('close', () => resolve());
  });

  void warm();
  await closed;
}

/**
 * Promesa con tope.
 *
 * Si la promesa no llega a tiempo, se rinde: una espera sin tope deja el
 * turno colgado, que es peor que no tener respuesta.
 */
async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`el host no respondio en ${ms}ms`)),
          ms,
        );
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Espera un rato. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms).unref?.();
  });
}

/** Dice si un proceso sigue vivo. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Dice si el host se niega a abrir la sesion.
 *
 * Las sesiones de subagente son internas: el host no las abre a nadie, y
 * reintentar solo gasta trabajo.
 */
export function isInternalSession(message: string): boolean {
  return /internal/i.test(message) && /cannot be opened|are internal/i.test(message);
}

interface ConnectionContext {
  getAdapter: () => AcpGoalAdapter | undefined;
  build: () => AcpGoalAdapter;
  sessionId: string;
  logger: Logger;
  isReady: () => boolean;
  failure: () => string | undefined;
  /** El ultimo estado del objetivo conocido: `undefined` si aun no se sabe. */
  goal: () => GoalState | null | undefined;
  /** Guarda el estado del objetivo que acaba de preguntarse al host. */
  setGoal: (goal: GoalState | null | undefined) => void;
  shutdown: () => Promise<void>;
}

/** Atiende a un cliente: una peticion por linea, una respuesta por linea. */
function handleConnection(socket: Socket, context: ConnectionContext): void {
  let buffer = '';

  socket.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    let index = buffer.indexOf('\n');
    while (index !== -1) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line) void answer(line, socket, context);
      index = buffer.indexOf('\n');
    }
  });

  socket.on('error', () => {
    // Un cliente que se va no es un problema: el proceso sigue sirviendo.
  });
}

/** Responde a una peticion. */
async function answer(line: string, socket: Socket, context: ConnectionContext): Promise<void> {
  const request = parseKeeperRequest(line);
  if (!request) {
    write(socket, { ok: false, error: 'peticion que no se entiende' });
    return;
  }

  if (request.action === 'close') {
    write(socket, { ok: true });
    // El cierre va despues de responder: quien lo pidio tiene que recibir la
    // respuesta antes de que el socket se cierre.
    setTimeout(() => {
      void context.shutdown();
    }, 50);
    return;
  }

  const response = await serve(request, context);
  write(socket, response);
}

/** Ejecuta la peticion contra el host. */
async function serve(request: KeeperRequest, context: ConnectionContext): Promise<KeeperResponse> {
  if (request.action === 'ping') {
    return { ok: true, ready: context.isReady() };
  }

  const started = Date.now();
  try {
    let adapter = context.getAdapter();
    if (!adapter) {
      // El host todavia no estaba listo: se intenta una vez mas, y si no, la
      // peticion falla y quien la pidio decide que hacer.
      const candidate = context.build();
      await candidate.start();
      adapter = candidate;
    }

    const sessionId = context.sessionId;
    const response = await serveOnHost(request, adapter, sessionId, context);
    context.logger.info(`${request.action} atendido en ${Date.now() - started} ms`);
    return response;
  } catch (err) {
    context.logger.warn(
      `${request.action} no se pudo atender en ${Date.now() - started} ms: ${(err as Error).message}`,
    );
    return { ok: false, error: (err as Error).message };
  }
}

/** Ejecuta la peticion contra el host que ya esta conectado. */
async function serveOnHost(
  request: KeeperRequest,
  adapter: AcpGoalAdapter,
  sessionId: string,
  context: ConnectionContext,
): Promise<KeeperResponse> {
  switch (request.action) {
    case 'read': {
      // Preguntar al host y esperar es lo que hace que el hook agote su
      // margen: mientras el hook corre, el host que tiene el objetivo esta
      // ocupado esperando al hook. El proceso vivo ya sabe cual es el
      // objetivo, asi que se responde con lo que sabe.
      const cached = context.goal();
      if (cached !== undefined) return { ok: true, goal: cached };
      // Aun no se sabe: se pregunta, pero con un tope corto. Si el host no
      // contesta, se responde con un error y no con "no hay objetivo": callar
      // seria afirmar algo que no se sabe, y podria crear un objetivo que ya
      // existe.
      try {
        const goal = await withTimeout(adapter.read(sessionId), GOAL_READ_TIMEOUT_MS);
        context.setGoal(goal);
        return { ok: true, goal };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    }
    case 'create': {
      const created = await adapter.create(
        sessionId,
        request.objective ?? '',
        request.tokenBudget,
      );
      // El objetivo nuevo se guarda ya: el aviso de cambio llega despues, y
      // hasta que llega, leer dariia el objetivo anterior. Un objetivo
      // anterior que ya esta completo habilita encadenar otra vez.
      context.setGoal(created);
      return { ok: true, goal: created };
    }
    case 'pause': {
      const paused = await adapter.pause(sessionId);
      context.setGoal(paused);
      return { ok: true, goal: paused };
    }
    case 'resume': {
      const resumed = await adapter.resume(sessionId);
      context.setGoal(resumed);
      return { ok: true, goal: resumed };
    }
    case 'clear': {
      const cleared = await adapter.clear(sessionId);
      // Sin objetivo ya no hay nada que recordar: dejarlo seria decir que hay
      // un objetivo que se puede volver a crear.
      if (cleared) context.setGoal(null);
      return { ok: true, cleared };
    }
    default:
      return { ok: false, error: `peticion que no se entiende: ${request.action}` };
  }
}

/** Escribe una respuesta en el socket. */
function write(socket: Socket, response: KeeperResponse): void {
  if (socket.destroyed) return;
  socket.write(`${JSON.stringify(response)}\n`);
}

/** Opciones que el proceso vivo recibe por linea de ordenes. */
export interface KeeperArgs {
  sessionId?: string;
  workspace?: string;
  socketPath?: string;
  ownerPid?: number | undefined;
  command?: string;
  args?: string[] | undefined;
}

/** Lee las opciones del proceso vivo de la linea de ordenes. */
export function parseKeeperArgs(argv: string[]): KeeperArgs {
  const parsed: KeeperArgs = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case '--session':
        parsed.sessionId = value;
        i += 1;
        break;
      case '--workspace':
        parsed.workspace = value;
        i += 1;
        break;
      case '--socket':
        parsed.socketPath = value;
        i += 1;
        break;
      case '--owner':
        parsed.ownerPid = value === undefined ? undefined : Number(value);
        i += 1;
        break;
      case '--host':
        parsed.command = value;
        i += 1;
        break;
      case '--host-args':
        try {
          const decoded = JSON.parse(value ?? '[]') as unknown;
          parsed.args = Array.isArray(decoded) ? decoded.map((item) => String(item)) : undefined;
        } catch {
          parsed.args = undefined;
        }
        i += 1;
        break;
      default:
        break;
    }
  }
  return parsed;
}

/** Registro que escribe en la salida de error: la salida normal es del hook. */
const logger = {
  info: (message: string) => process.stderr.write(`[goal-compass] ${message}\n`),
  warn: (message: string) => process.stderr.write(`[goal-compass] AVISO ${message}\n`),
  error: (message: string) => process.stderr.write(`[goal-compass] ERROR ${message}\n`),
};

/**
 * Registro que escribe en un fichero.
 *
 * El proceso vivo se lanza sin salida que nadie lea: su rastro tiene que
 * quedar en un sitio donde se pueda mirar despues.
 */
export function fileLogger(path: string): Logger {
  const write = (level: string, message: string): void => {
    try {
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, `[${new Date().toISOString()}] ${level} ${message}\n`, 'utf8');
    } catch {
      // Si el rastro no se puede escribir, el trabajo sigue: lo que importa
      // es que el proceso vivo atienda las consultas.
    }
  };
  return {
    info: (message: string) => write('INFO', message),
    warn: (message: string) => write('AVISO', message),
    error: (message: string) => write('ERROR', message),
  };
}

/** Punto de entrada: el proceso vivo se lanza con sus opciones por ordenes. */
async function main(): Promise<void> {
  const args = parseKeeperArgs(process.argv.slice(2));
  if (!args.sessionId || !args.workspace || !args.socketPath) {
    logger.error('el proceso vivo necesita la sesion, el workspace y el socket');
    process.exit(1);
  }

  await runKeeper({
    sessionId: args.sessionId,
    workspace: args.workspace,
    socketPath: args.socketPath,
    ownerPid: args.ownerPid,
    ...(args.command !== undefined ? { host: { command: args.command, args: args.args } } : {}),
  });
}

/**
 * Indica si este fichero es el punto de entrada.
 *
 * Se comparan las rutas reales y no las escritas: el proceso se puede lanzar
 * por un camino con enlaces simbolicos, y entonces las dos rutas distintas
 * parecen dos ficheros que no son el mismo.
 */
function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  main().catch((err: unknown) => {
    logger.error(String(err));
    process.exit(1);
  });
}
