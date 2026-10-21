/**
 * El texto que se inyecta vive en un fichero, no en el codigo.
 *
 * Es la manera de conducir la sesion, y por eso tiene que ser editable sin
 * reinstalar nada: quien conduce es quien lo escribe. Aqui se comprueba lo que
 * de verdad importa —que se cree solo la primera vez, que se pueda cambiar sin
 * tocar el codigo, y que un fichero vacio sea una decision y no un descuido.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { NUDGE_PROMPT_INICIAL, nudgePromptPath, readNudgePrompt } from '../src/plugin/nudge-prompt.js';
import { tempDir } from './support/temp.js';

const MISION = 'prueba';

describe('el texto que se inyecta se lleva a un fichero', () => {
  it('la primera vez se crea solo, con el texto inicial', () => {
    const home = tempDir('gcl-nudge-cfg-');
    const path = nudgePromptPath(MISION, home);

    expect(existsSync(path)).toBe(false);
    expect(readNudgePrompt(MISION, home)).toBe(NUDGE_PROMPT_INICIAL);

    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, 'utf8').trim()).toBe(NUDGE_PROMPT_INICIAL);
  });

  it('se lee lo que haya escrito, sin tocar el codigo ni pedir nada', () => {
    const home = tempDir('gcl-nudge-cfg-');
    readNudgePrompt(MISION, home);

    const mio = 'anda con lo tuyo y no me preguntes';
    writeFileSync(nudgePromptPath(MISION, home), `${mio}\n`, 'utf8');

    expect(readNudgePrompt(MISION, home)).toBe(mio);
  });

  it('cada mision tiene el suyo, para que dos repos no se pisen', () => {
    const home = tempDir('gcl-nudge-cfg-');
    const otra = tempDir('gcl-nudge-cfg-');
    mkdirSync(dirname(nudgePromptPath('una', home)), { recursive: true });
    mkdirSync(dirname(nudgePromptPath('otra', otra)), { recursive: true });

    writeFileSync(nudgePromptPath('una', home), 'texto de una', 'utf8');
    writeFileSync(nudgePromptPath('otra', otra), 'texto de otra', 'utf8');

    expect(readNudgePrompt('una', home)).toBe('texto de una');
    expect(readNudgePrompt('otra', otra)).toBe('texto de otra');
    expect(nudgePromptPath('una', home)).not.toBe(nudgePromptPath('otra', otra));
  });

  it('un fichero vacio no es un fallo: callar tambien puede ser la decision', () => {
    const home = tempDir('gcl-nudge-cfg-');
    readNudgePrompt(MISION, home);
    writeFileSync(nudgePromptPath(MISION, home), '   \n', 'utf8');

    // No se inventa nada: se cae al texto inicial en vez de inyectar en blanco,
    // porque un prompt vacio no le dice nada a nadie.
    expect(readNudgePrompt(MISION, home)).toBe(NUDGE_PROMPT_INICIAL);
  });

  it('el texto inicial dirige la sesion en vez de limitarse a encadenar', () => {
    // Lo que se inyecta tiene que mover la cadena, no solo recordarle que
    // existe: si solo encadena, el empujon se queda corto.
    expect(NUDGE_PROMPT_INICIAL).toContain('roadmap');
    expect(NUDGE_PROMPT_INICIAL).toContain('bloqueos');
    expect(NUDGE_PROMPT_INICIAL).toContain('ambigüedades y bloqueos');
  });
});