/**
 * Hooks del ciclo de vida de la sesion.
 *
 * Cuando la sesion empieza, el plugin levanta un proceso vivo: uno que se
 * queda con la sesion cargada en el host. Cargar la sesion es lo gordo: hay
 * que leer todo su historial, y el historial crece con cada turno. Con el
 * proceso vivo, esa carga se paga una vez, cuando el historial todavia es
 * pequeno, y crear el objetivo en los turnos siguientes cuesta milisegundos.
 *
 * Cuando la sesion termina, el proceso vivo se apaga.
 *
 * La salida de estos hooks es siempre vacia: no deciden nada, solo preparan
 * el terreno para que el hook de continuacion trabaje rapido.
 */
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, realpathSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KeeperGoalAdapter } from '../adapters/keeper-goal.js';
import { locateMission } from './mission-locator.js';
import { keeperSocketPath } from './keeper-protocol.js';
import { parseHookEvent, type HookEvent } from './hook-event.js';
import { readStdinPayload, STDIN_READ_DEADLINE_MS } from './stdin-payload.js';
import type { Logger } from '../ports.js';

/** Registro que escribe en la salida de error: la salida normal es del hook. */
const logger = {
  info: (message: string) => process.stderr.write(`[goal-compass] ${message}\n`),
  warn: (message: string) => process.stderr.write(`[goal-compass] AVISO ${message}\n`),
  error: (message: string) => process.stderr.write(`[goal-compass] ERROR ${message}\n`),
};

/** Opciones del hook de ciclo de vida. */
export interface SessionHookOptions {
  /** Donde se cuenta lo que va pasando. */
  logger?: Logger;
  /**
   * Como se lanza el proceso vivo.
   *
   * Por defecto se lanza con el ejecutable de Node y el fichero que hay
   * junto a este modulo, que es lo que funciona con el plugin ya montado.
   */
  keeper?: { command?: string; args?: string[] } | undefined;
  /** Proceso al que pertenece la sesion: cuando muere, muere el proceso vivo. */
  ownerPid?: number | undefined;
  /** Margen que espera una peticion al proceso vivo. */
  requestTimeoutMs?: number | undefined;
}

/**
 * Atiende el hook de ciclo de vida de la sesion.
 *
 * Devuelve siempre una cadena vacia: estos hooks no dicen nada al host.
 */
export async function runSessionHook(raw: string, options: SessionHookOptions = {}): Promise<string> {
  const event = parseHookEvent(raw);
  if (!event) return '';

  const log = options.logger ?? logger;
  const name = event.hook_event_name;
  if (name === 'SessionStart') {
    await startKeeper(event, log, options);
    return '';
  }
  if (name === 'SessionEnd') {
    await stopKeeper(event, log, options);
    return '';
  }
  return '';
}

/**
 * Levanta el proceso vivo de la sesion.
 *
 * Solo se levanta cuando el directorio declara una mision: sin mision no
 * hay nada que encadenar, y un proceso vivo seria trabajo de sobra.
 */
async function startKeeper(event: HookEvent, log: Logger, options: SessionHookOptions): Promise<void> {
  const cwd = event.cwd;
  const sessionId = event.session_id;
  if (!cwd || !sessionId) return;

  const mission = locateMission(cwd);
  if (!mission) return;

  const socketPath = keeperSocketPath(sessionId);
  note(socketPath, `inicio de sesion: ${JSON.stringify(event)}`, log);
  if (await keeperAlive(socketPath)) {
    log.info('esta sesion ya tiene un proceso vivo: no se levanta otro');
    return;
  }

  const entry = keeperEntryPoint();
  const ownerPid = options.ownerPid ?? process.ppid;
  const command = options.keeper?.command ?? process.execPath;
  const baseArgs = options.keeper?.args ?? [entry];
  const child = spawn(
    command,
    [
      ...baseArgs,
      '--session',
      sessionId,
      '--workspace',
      mission.workspace,
      '--socket',
      socketPath,
      '--owner',
      String(ownerPid),
    ],
    { cwd: mission.workspace, detached: true, stdio: 'ignore' },
  );
  child.unref();
  log.info(`proceso vivo lanzado para la sesion ${sessionId}`);
}

/**
 * Apaga el proceso vivo de la sesion.
 *
 * Si no hay nadie escuchando, no hay nada que apagar.
 */
async function stopKeeper(event: HookEvent, log: Logger, options: SessionHookOptions): Promise<void> {
  const sessionId = event.session_id;
  if (!sessionId) return;

  const socketPath = keeperSocketPath(sessionId);
  if (!existsSync(socketPath)) return;

  const adapter = new KeeperGoalAdapter({
    sessionId,
    socketPath,
    logger: log,
    requestTimeoutMs: options.requestTimeoutMs ?? 1_500,
  });
  try {
    await adapter.start();
    await adapter.shutdown();
    log.info('proceso vivo apagado');
  } catch (err) {
    log.warn(`no se pudo apagar el proceso vivo: ${(err as Error).message}`);
  } finally {
    await adapter.close().catch(() => {});
  }
}

/**
 * Deja una nota en el rastro del proceso vivo.
 *
 * El hook se ejecuta sin salida que nadie lea, asi que su rastro va al mismo
 * fichero donde el proceso vivo cuenta lo que hace.
 */
function note(socketPath: string, message: string, log: Logger): void {
  const path = `${socketPath}.log`;
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `[${new Date().toISOString()}] INFO ${message}\n`, 'utf8');
  } catch {
    log.warn('no se pudo dejar la nota del hook en el rastro');
  }
}

/** Dice si hay un proceso vivo escuchando en el socket. */
async function keeperAlive(socketPath: string): Promise<boolean> {
  if (!existsSync(socketPath)) return false;
  const adapter = new KeeperGoalAdapter({
    sessionId: 'sondeo',
    socketPath,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    requestTimeoutMs: 1_000,
  });
  try {
    await adapter.start();
    const alive = await adapter.ping();
    await adapter.close();
    return alive;
  } catch {
    return false;
  }
}

/** Ruta del fichero que arranca el proceso vivo. */
function keeperEntryPoint(): string {
  return fileURLToPath(new URL('./host-keeper.js', import.meta.url));
}

/**
 * Indica si este fichero es el punto de entrada.
 *
 * Se comparan las rutas reales y no las escritas: el host puede invocar el
 * hook por un camino con enlaces simbolicos, y entonces las dos rutas
 * distintas parecen dos ficheros que no son el mismo.
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

/** Punto de entrada: el host ejecuta este fichero y lee su salida. */
async function main(): Promise<void> {
  let raw: string;
  try {
    raw = await readStdinPayload(STDIN_READ_DEADLINE_MS);
  } catch (err) {
    logger.error(String(err));
    process.exit(0);
  }
  await runSessionHook(raw);
  process.exit(0);
}

if (isEntryPoint()) {
  main().catch((err: unknown) => {
    logger.error(String(err));
    process.exitCode = 0;
  });
}
