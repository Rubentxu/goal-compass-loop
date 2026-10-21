/**
 * El texto que se inyecta en la sesion cuando hay que empujarla.
 *
 * Va en un fichero y no en el codigo porque es tuyo: el texto es la manera de
 * conducir la sesion, y quien conduce es quien lo escribe. Aqui solo se decide
 * donde vive, que se crea si no esta, y que se lee tal cual.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** El texto con el que arranca, hasta que se edite el fichero. */
export const NUDGE_PROMPT_INICIAL = [
  'ok pues vamos completar o a mejorar la calidad de las implementaciones de los bloques del',
  'roadmap, propuestas nuevas (de las que me sienta orgulloso) o sugerencias de reportes',
  'anteriores, a tu criterio. Resuelve ambigüedades y bloqueos, escoge inteligentemente las',
  'mejores respuestas con foco en valor operativo y facilidad, queda aprobado todas los gates',
  'humanos. Simplifica, reduce la cantidad de tests UAT/e2e pero mejora la calidad de test',
  'harness. Usa la skill `delivery-first-testing`, su router `references/navigation.md` y las',
  'lentes disponibles según el estado real. Por favor ten en cuenta que no se deja comentarios',
  'con referencias, identificadores de tareas, especificaciones, ni nombres en los comentarios',
  'de codigo, debe ser estandar y enfocado a explicar la funcionalidad integra. Todo en',
  'remoto al concluir ciclos y explica para novatos que se hizo en el ciclo. Busca la',
  'elegancia en el código, has que me sienta MUY ORGULLOSO.',
].join(' ');

/** Donde vive lo que se inyecta. Por mision, para que dos repos no se pisen. */
export function nudgePromptPath(missionId: string, configHome?: string): string {
  const xdg = configHome ?? process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.trim() ? xdg : join(homedir(), '.config');
  return join(base, 'goal-compass', missionId, 'nudge.md');
}

/**
 * Lo que se inyecta, del fichero de quien lo conduce.
 *
 * Si el fichero no existe se crea con el texto inicial: asi la primera vez se
 * lee algo util y a partir de ahi se edita lo que se quiera, sin tocar el
 * codigo ni reinstalar nada.
 *
 * Un fichero vacio tambien es una decision —callar a proposito— asi que se
 * respeta: no se rellena solo.
 */
export function readNudgePrompt(missionId: string, configHome?: string): string {
  const path = nudgePromptPath(missionId, configHome);
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${NUDGE_PROMPT_INICIAL}\n`, 'utf8');
    return NUDGE_PROMPT_INICIAL;
  }
  return readFileSync(path, 'utf8').trim() || NUDGE_PROMPT_INICIAL;
}