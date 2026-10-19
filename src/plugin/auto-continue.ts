/**
 * Continuacion de la mision cuando el agente cierra su turno.
 *
 * Es el corazon del plugin: cuando el objetivo en curso termina, este modulo
 * encadena el siguiente en la misma sesion en la que esta trabajando el
 * agente. No hay un proceso de fondo esperando: el propio cierre de turno
 * del agente es el latido de la mision.
 *
 * Reglas que no se saltan:
 *  - Solo `complete` habilita encadenar. Un objetivo activo, pausado o
 *    bloqueado se deja como esta.
 *  - Si algo falla, el turno continua igual. Un plugin nunca deja al
 *    usuario sin respuesta por un problema propio.
 */
import { existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMissionConfig, openMission } from '../runtime.js';
import type { Logger } from '../ports.js';

/** Ficheros donde puede estar la declaracion de una mision, por orden. */
const MISSION_FILES = ['goal-compass.json', join('.goal-compass', 'mission.json')];

/**
 * Margen que el hook se da a si mismo.
 *
 * El host corta el hook pasado su tiempo, y un corte a media faena deja a
 * medias una sesion del host. Es mejor pararse antes y dejar la mision como
 * estaba: el siguiente turno lo intentara de nuevo.
 */
const DEADLINE_MS = 9_000;

export interface HookEvent {
  hook_event_name?: string;
  session_id?: string;
  cwd?: string;
  payload?: {
    stop_hook_active?: boolean;
    last_assistant_message?: string;
  };
}

/** Registro que escribe en la salida de error: la salida normal es del hook. */
const logger = {
  info: (message: string) => process.stderr.write(`[goal-compass] ${message}\n`),
  warn: (message: string) => process.stderr.write(`[goal-compass] AVISO ${message}\n`),
  error: (message: string) => process.stderr.write(`[goal-compass] ERROR ${message}\n`),
};

/** Busca el fichero de mision del workspace. */
export function findMissionFile(cwd: string): string | null {
  for (const name of MISSION_FILES) {
    const candidate = join(cwd, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Interpreta el evento que el host entrega por la entrada estandar. */
export function parseHookEvent(raw: string): HookEvent | null {
  if (!raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as HookEvent;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** Opciones del disparo de continuacion. */
export interface AutoContinueOptions {
  /** Margen de tiempo del hook. */
  deadlineMs?: number;
  /** Ejecutable del host, cuando no es el de por defecto. */
  host?: { command?: string; args?: string[] };
  /** Donde se cuenta lo que va pasando. */
  logger?: Logger;
}

/**
 * Encadena el siguiente objetivo si toca, y devuelve lo que el host debe
 * hacer con el turno. Una cadena vacia significa "no hay nada que decir".
 */
export async function runAutoContinue(
  raw: string,
  options: AutoContinueOptions = {},
): Promise<string> {
  const deadlineMs = options.deadlineMs ?? DEADLINE_MS;
  const log = options.logger ?? logger;
  const event = parseHookEvent(raw);
  if (!event) return '';

  const sessionId = event.session_id;
  const cwd = event.cwd;
  if (!sessionId || !cwd) return '';

  const missionFile = findMissionFile(cwd);
  if (!missionFile) return '';

  let runtime: Awaited<ReturnType<typeof openMission>> | undefined;
  let finished = false;

  const work = (async (): Promise<string> => {
    try {
      const config = readMissionConfig(missionFile, cwd);
      runtime = await openMission({
        config,
        configPath: missionFile,
        logger: log,
        sessionId,
        ...(options.host ? { host: options.host } : {}),
        // Preguntar al modelo por trabajo consume tiempo y el turno tiene un
        // limite: la exploracion la hace el agente, no el hook.
        exploration: false,
      });

      const outcome = await runtime.supervisor.step();
      if (!outcome.created) return '';

      log.info(`objetivo encadenado: ${outcome.created.goalId}`);
      return JSON.stringify({
        decision: 'block',
        reason: continuePrompt(outcome.created.objective),
      });
    } catch (err) {
      log.warn(`no se pudo encadenar el objetivo siguiente: ${(err as Error).message}`);
      return '';
    } finally {
      finished = true;
      await runtime?.adapter.close();
    }
  })();

  const guard = new Promise<string>((resolve) => {
    setTimeout(() => {
      if (finished) return;
      log.warn('el hook se queda sin tiempo: la mision sigue como estaba');
      resolve('');
    }, deadlineMs).unref();
  });

  return Promise.race([work, guard]);
}

/** Lo que el agente recibe para seguir trabajando. */
function continuePrompt(objective: string): string {
  return (
    `La mision continua: el objetivo siguiente ya esta creado y activo.\n` +
    `Objetivo: ${objective}\n\n` +
    `Trabaja ese objetivo con la skill goal-compass: empieza por graph/index.md, ` +
    `elige solo el nodo que corresponda y ejecuta una accion pequena y verificable. ` +
    `Cuando su alcance este probado, cierralo con update_goal(status=complete).`
  );
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
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8');
  const output = await runAutoContinue(raw);
  if (output) process.stdout.write(`${output}\n`);
}

if (isEntryPoint()) {
  main().catch((err) => {
    logger.error(String(err));
    process.exitCode = 0;
  });
}
