/**
 * El proceso vivo sabe recibir un empujón.
 *
 * Es la diferencia entre empujar a una sesión desde fuera (un proceso aparte,
 * que el usuario no ve hasta que vuelve) y empujar **a la sesión que tiene
 * delante**: el texto entra por el mismo sitio que entra cualquier otro
 * mensaje, así que aparece en la terminal.
 */
import { describe, expect, it } from 'vitest';
import { parseKeeperRequest } from '../src/plugin/keeper-protocol.js';

describe('el protocolo del keeper admite un empujon', () => {
  it('interpreta la peticion de empujon con su texto', () => {
    const peticion = parseKeeperRequest(
      JSON.stringify({ action: 'prompt', text: 'Sigue con lo que te falta' }),
    );

    expect(peticion?.action).toBe('prompt');
    expect(peticion?.text).toBe('Sigue con lo que te falta');
  });

  it('no se inventa texto donde no lo hay', () => {
    const peticion = parseKeeperRequest(JSON.stringify({ action: 'prompt' }));

    expect(peticion?.action).toBe('prompt');
    expect(peticion?.text).toBeUndefined();
  });

  it('sigue rechazando lo que no es una peticion', () => {
    expect(parseKeeperRequest(JSON.stringify({ action: 'inventada' }))).toBeNull();
    expect(parseKeeperRequest('no es json')).toBeNull();
  });
});
