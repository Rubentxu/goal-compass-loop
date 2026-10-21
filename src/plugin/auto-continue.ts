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
 *  - El hook no devuelve texto para continuar el turno. El host ya entrega
 *    el objetivo recien creado en un turno propio, y ahi el agente conserva
 *    las herramientas. Cerrar el turno es lo que el host espera; alargar el
 *    turno aqui es lo que se las quita.
 */
import { realpathSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AcpGoalAdapter } from '../adapters/acp-goal.js';
import { KeeperGoalAdapter } from '../adapters/keeper-goal.js';
import { openMission } from '../runtime.js';
import { locateMission } from './mission-locator.js';
import { keeperSocketPath } from './keeper-protocol.js';
import { parseHookEvent, type HookEvent } from './hook-event.js';
import { readStdinPayload, STDIN_READ_DEADLINE_MS } from './stdin-payload.js';
import type { GoalAdapter, Logger } from '../ports.js';
import type { Journal } from '../core/types.js';

export { parseHookEvent };
export type { HookEvent };

/**
 * Margen que el hook se da a si mismo.
 *
 * El host corta el hook pasado su tiempo, y un corte a media faena deja a
 * medias una sesion del host. Es mejor pararse antes y dejar la mision como
 * estaba: el siguiente turno lo intentara de nuevo.
 *
 * El host da a un hook de plugin diez segundos como maximo, y el manifiesto
 * no puede pedir mas. El camino normal —preguntar al proceso vivo— dura
 * milisegundos; el margen cubre el camino de reserva, que es abrir un host
 * nuevo y cargarle la sesion. Si el hook se pasa, el host lo tira y el turno
 * se queda sin continuacion: peor que no encadenar nada.
 */
const DEADLINE_MS = 9_500;

/** Registro que escribe en la salida de error: la salida normal es del hook. */
const logger = {
  info: (message: string) => process.stderr.write(`[goal-compass] ${message}\n`),
  warn: (message: string) => process.stderr.write(`[goal-compass] AVISO ${message}\n`),
  error: (message: string) => process.stderr.write(`[goal-compass] ERROR ${message}\n`),
};

/** Opciones del disparo de continuacion. */
export interface AutoContinueOptions {
  /** Margen de tiempo del hook. */
  deadlineMs?: number;
  /** Milisegundos que una peticion al host puede esperar. */
  requestTimeoutMs?: number;
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

  const mission = locateMission(cwd);
  if (!mission) return '';

  let runtime: Awaited<ReturnType<typeof openMission>> | undefined;
  let adapter: GoalAdapter | undefined;
  let finished = false;

  const work = (async (): Promise<string> => {
    try {
      // El adaptador se construye aqui para poderlo cerrar aunque la mision no
      // llegue a arrancarse: el host es un proceso, y un proceso sin cerrar
      // deja al hook sin terminar nunca.
      //
      // Se prefiere el proceso vivo: uno que ya tiene la sesion cargada en el
      // host. Crear el objetivo por ahi cuesta milisegundos, mientras que
      // abrir un host nuevo y cargarle la sesion cuesta segundos, y esa
      // carga crece con el historial de la sesion.
      const keeper = await connectKeeper(sessionId, log, options);
      adapter =
        keeper ??
        new AcpGoalAdapter({
          workspace: mission.config.workspace,
          sessionId,
          logger: log,
          ...(options.host?.command !== undefined ? { command: options.host.command } : {}),
          ...(options.host?.args !== undefined ? { args: options.host.args } : {}),
          ...(options.requestTimeoutMs !== undefined
            ? { requestTimeoutMs: options.requestTimeoutMs }
            : {}),
        });

      runtime = await openMission({
        config: mission.config,
        configPath: mission.configPath,
        logger: log,
        sessionId,
        driver: 'plugin',
        adapter,
        // Preguntar al modelo por trabajo consume tiempo y el turno tiene un
        // limite: la exploracion la hace el agente, no el hook.
        exploration: false,
        // El objetivo es lo unico que el host entrega al agente cuando
        // encadena un objetivo nuevo. Lo que el agente tiene que saber antes
        // de empezar —como trabajar, que no puede hacer, donde esta la
        // mision— viaja dentro del objetivo.
        hostObjectiveAddon: (journal, info) =>
          objectiveAddon(mission.config.allowRemoteWrite, journal, info.retried),
      });

      if (!runtime.driving) {
        log.info(`el hook no encadena nada: ${runtime.reason ?? 'la mision la conduce otro camino'}`);
        return '';
      }

      const outcome = await runtime.supervisor.step();
      if (!outcome.created) return '';

      log.info(`objetivo encadenado: ${outcome.created.goalId}`);
      // El turno se cierra aqui sin decir nada. El host entrega el objetivo
      // recien creado en un turno propio, y en ese turno el agente puede
      // seguir usando sus herramientas: leer lo que una herramienta devuelve
      // es la diferencia entre trabajar y trabajar a ciegas.
      return '';
    } catch (err) {
      log.warn(`no se pudo encadenar el objetivo siguiente: ${(err as Error).message}`);
      return '';
    } finally {
      finished = true;
      await adapter?.close().catch(() => {});
    }
  })();

  const guard = new Promise<string>((resolve) => {
    setTimeout(() => {
      if (finished) return;
      log.warn('el hook se queda sin tiempo: la mision sigue como estaba');
      // El host se cierra aqui: si no, el hook no termina, el host espera su
      // propio limite y tira lo que hemos preparado.
      void adapter?.close().catch(() => {});
      resolve('');
    }, deadlineMs).unref();
  });

  return Promise.race([work, guard]);
}

/**
 * Conecta con el proceso vivo de la sesion, si lo hay.
 *
 * Devuelve `undefined` cuando no hay nadie escuchando: entonces el hook
 * abre su propio host, como siempre. No es un fallo: es el camino de
 * reserva, y sigue siendo valido mientras la sesion no sea muy grande.
 */
async function connectKeeper(
  sessionId: string,
  log: Logger,
  options: AutoContinueOptions,
): Promise<KeeperGoalAdapter | undefined> {
  const socketPath = keeperSocketPath(sessionId);
  if (!existsSync(socketPath)) return undefined;

  const adapter = new KeeperGoalAdapter({
    sessionId,
    socketPath,
    logger: log,
    ...(options.requestTimeoutMs !== undefined
      ? { requestTimeoutMs: options.requestTimeoutMs }
      : {}),
  });

  try {
    await adapter.start();
    const alive = await adapter.ping();
    if (!alive) {
      await adapter.close();
      return undefined;
    }
    log.info('el proceso vivo responde: el objetivo se creara por ahi');
    return adapter;
  } catch (err) {
    log.warn(`el proceso vivo no responde: ${(err as Error).message}`);
    await adapter.close().catch(() => {});
    return undefined;
  }
}

/**
 * Lo que el agente recibe para seguir trabajando.
 *
 * Viaja dentro del objetivo, y no en un mensaje aparte, porque el objetivo es
 * lo unico que el host lleva al agente cuando encadena un objetivo nuevo. Lo
 * que queda fuera, no llega.
 *
 * El limite de publicacion de la mision viaja aqui porque el agente es el
 * unico que puede hacer push, publicar o desplegar: si la mision no lo
 * autoriza, el agente tiene que saberlo antes de empezar.
 *
 * Y con el limite viaja el contexto, porque un objetivo sin contexto obliga a
 * rededucir el estado del proyecto en cada turno. El objetivo dice donde esta
 * la mision ahora mismo: cuanto ha hecho, cuanto le queda y que se esta
 * trabajando.
 *
 * La ultima parte es la que cierra el bucle: al terminar, el agente deja el
 * trabajo siguiente propuesto. Sin eso, la cadena se queda sin fuel en cuanto
 * la cola se vacia, aunque la mision siga viva.
 */
function objectiveAddon(
  allowRemoteWrite: boolean,
  state: Journal,
  retried = false,
): string[] {
  const boundary = allowRemoteWrite
    ? 'La mision autoriza publicar, pero hace falta autorizacion explicita del usuario.'
    : 'La mision no autoriza publicar: no hagas push, ni tag, ni release, ni despliegue.';

  const lines: string[] = [];

  if (retried) {
    lines.push(
      'Este objetivo se quedo sin presupuesto la vez anterior: es el mismo trabajo ' +
        'reintentado con mas margen. Lo que ya hiciste sigue en pie.',
      '',
    );
  }

  lines.push(
    'Trabaja ese objetivo con la skill goal-compass: empieza por el nodo de ' +
      'entrada del arbol, elige solo el nodo que corresponda y ejecuta una accion ' +
      'pequena y verificable. Cuando su alcance este probado, cierralo con ' +
      'update_goal(status=complete).',
    '',
    closingRule(),
    '',
    'Cuando termines, deja el trabajo siguiente: con mission_propose, la evidencia ' +
      'que lo respalda y como se sabra que esta hecho. Si de verdad no hay trabajo ' +
      'que quede, dilo con claridad en vez de inventarlo. La cadena sigue mientras ' +
      'alguien deje trabajo.',
    '',
    contextOf(state),
    '',
    `Limite de la mision: ${boundary}`,
  );

  return lines;
}

/**
 * Cuando cerrar el objetivo es posible, y que hacer cuando no lo es.
 *
 * Cerrar solo funciona desde el turno que abrio el objetivo. Un turno que
 * abrio otra persona —el usuario escribio mientras el objetivo seguia vivo— no
 * esta ligado a el, y el runtime lo dice. Esa respuesta no es un fallo que
 * arreglar: no hay nada que arreglar aqui, porque la puerta no esta en este
 * plugin sino en el host, y revisarlo a mano no la abre. Lo que corresponde es
 * terminar el turno y dejar que la cadena devuelva el control, que es lo que
 * hace por su cuenta.
 *
 * Se dice de forma explicita porque el mensaje de rechazo menciona el vinculo
 * de turno, y eso invita a buscar el vinculo, y esa busqueda ya ha costado
 * media hora de llamadas.
 */
function closingRule(): string {
  return [
    'Cerrar el objetivo tiene una regla que conviene saber antes de necesitarla:',
    '- update_goal solo responde en el turno que abrio este objetivo.',
    '- Si el runtime lo rechaza diciendo que el turno no esta ligado al objetivo,',
    '  no busques el mecanismo ni lo repares: no esta en este plugin. Termina el',
    '  turno con lo que tengas y deja que la cadena te devuelva el control.',
    '- Si ademas dice que el objetivo esta pausado, mission_resume lo revive.',
  ].join(' ');
}

/**
 * El estado de la mision en el momento de encadenar el objetivo.
 *
 * Es lo que el agente necesita para no empezar a ciegas: que se ha hecho, que
 * queda y por que la mision esta como esta.
 */
function contextOf(state: Journal): string {
  const completed = state.goals.filter((goal) => goal.status === 'complete');
  const metrics = state.metrics;
  const tokens =
    metrics?.tokensUsed ?? state.goals.reduce((total, goal) => total + goal.tokensUsed, 0);
  const budget = state.mission.totalTokenBudget;
  const last = completed[completed.length - 1];
  const chained =
    metrics?.goalsCreated ?? state.intents.filter((intent) => intent.status === 'committed').length;
  const exhaustions = metrics?.budgetExhaustions ?? state.budgetAttempts?.length ?? 0;

  const lines = [
    `Contexto de la mision "${state.mission.missionId}":`,
    `- estado: ${state.mission.status}${state.mission.reason ? ` (${state.mission.reason})` : ''}`,
    `- objetivos completados: ${completed.length}` +
      (last ? `; el ultimo fue "${last.objective}"` : ''),
    `- objetivos encadenados antes de este: ${chained}`,
    `- presupuesto: ${tokens} token(s)${budget !== null ? ` de ${budget}` : ''}` +
      (metrics?.budgetExceeded ? ' (superado: la cadena sigue, el presupuesto es una medida)' : ''),
    `- trabajo declarado pendiente: ${state.mission.backlog.length} candidato(s)`,
  ];

  if (exhaustions > 0) {
    lines.push(`- intentos que se quedaron sin presupuesto: ${exhaustions}`);
  }

  return lines.join('\n');
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

/**
 * Un numero del entorno, si lo hay.
 *
 * Sirve para acortar las esperas cuando hay que depurar: no cambia el
 * comportamiento normal.
 */
function readNumber(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw || !raw.trim()) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/** Punto de entrada: el host ejecuta este fichero y lee su salida. */
async function main(): Promise<void> {
  // El margen del host es para TODO el hook: leer la carga y hacer el
  // trabajo. La lectura se lleva su parte y el trabajo se queda con el
  // resto, para que la suma no se pase nunca del limite.
  const startedAt = Date.now();
  let raw: string;
  try {
    raw = await readStdinPayload(STDIN_READ_DEADLINE_MS);
  } catch (err) {
    // Sin carga no hay nada que encadenar, y no es motivo para que el host
    // espere a su propio limite.
    logger.error(String(err));
    process.exit(0);
  }
  const remainingMs = Math.max(0, DEADLINE_MS - (Date.now() - startedAt));
  const output = await runAutoContinue(raw, {
    deadlineMs: remainingMs,
    ...readNumber('GOAL_COMPASS_REQUEST_TIMEOUT_MS')
      ? { requestTimeoutMs: readNumber('GOAL_COMPASS_REQUEST_TIMEOUT_MS')! }
      : {},
  });
  if (output) {
    // La salida se escribe antes de salir: si el proceso se va a mitad, el
    // host se queda sin la continuacion que prepared.
    await new Promise<void>((resolve) => process.stdout.write(`${output}\n`, () => resolve()));
  }
  // El hook termina aqui, siempre. Un hook que no termina hace que el host
  // espere a su propio limite y tire lo que este proceso iba a dizer.
  process.exit(0);
}

if (isEntryPoint()) {
  main().catch((err) => {
    logger.error(String(err));
    process.exitCode = 0;
  });
}
