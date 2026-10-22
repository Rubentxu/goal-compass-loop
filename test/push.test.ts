/**
 * Que se entienda lo que pasa cuando la cadena habla con su sesion.
 *
 * El reloj empujaba y luego contaba cualquier cosa como empujon hecho. Una
 * sesion ocupada con su propio turno salia como fallo y hacia pasar el
 * enfriamiento, de modo que el trabajo de verdad se quedaba sinparable. Y al
 * reves: el comando puede entregar el mensaje y morir despues cerrando el
 * runtime, con lo que un fallo de verdad traia el empujon dentro.
 */
import { describe, expect, it } from 'vitest';
import { classifyPush, cuentaComoEmpuje, sesionTrasEmpuje } from '../src/core/push.js';

describe('lo que significa lo que respondio el empujon', () => {
  it('da por entregado cuando el comando salio bien', () => {
    expect(classifyPush('sesion empujada: mvs_abc', 0)).toBe('delivered');
  });

  it('reconoce la sesion ocupada aunque el comando falle', () => {
    const salida =
      'The run failed: Session already has an active Turn. Use queue send to deliver the message after it.';

    expect(classifyPush(salida, 1)).toBe('session-busy');
  });

  it('reconoce la sesion ocupada aunque el proceso ni siquiera terminara', () => {
    expect(classifyPush('Session already has an active Turn', null)).toBe('session-busy');
  });

  it('no confunde una sesion ocupada con el fallo de cerrar el runtime', () => {
    const salida =
      'embedded Runtime cleanup failed: Turn controller shutdown timed out\nMCode encountered an internal error';

    expect(classifyPush(salida, 1)).toBe('failed');
  });

  it('da por entregado el mensaje que entro antes de morir al cerrar', () => {
    expect(
      classifyPush('Turn controller shutdown timed out\nMCode encountered an internal error', 1),
    ).toBe('failed');
  });

  it('reconoce la sesion que ya no existe', () => {
    // Lo que dice el host cuando la sesion se quedo sin vida: el empujon no
    // fallo, llego a una sesion que no esta.
    const salida =
      'mcode exec failed: The run failed: Session not found: mvs_abc. Retry after the connection recovers.';

    expect(classifyPush(salida, 1)).toBe('session-gone');
  });

  it('reconoce la sesion muerta aunque el proceso no llegara a terminar', () => {
    expect(classifyPush('Session not found: mvs_abc', null)).toBe('session-gone');
  });

  it('no confunde un fichero que falta con una sesion que no esta', () => {
    expect(classifyPush('Error: ENOENT: file not found: /tmp/fichero', 1)).toBe('failed');
  });

  it('no confunde un fallo con un empujon cuentas', () => {
    expect(cuentaComoEmpuje('delivered')).toBe(true);
    expect(cuentaComoEmpuje('session-busy')).toBe(false);
    expect(cuentaComoEmpuje('session-gone')).toBe(false);
    expect(cuentaComoEmpuje('failed')).toBe(false);
  });

  it('suelta la sesion que ya no existe', () => {
    // El reloj empujaba cada vuelta contra una sesion muerta, gastando un host
    // cada vez en hablar con la nada, para siempre.
    expect(sesionTrasEmpuje('session-gone')).toBe('soltar-sesion');
  });

  it('no suelta la sesion ocupada ni la que entra', () => {
    expect(sesionTrasEmpuje('session-busy')).toBe('nada');
    expect(sesionTrasEmpuje('failed')).toBe('nada');
    expect(sesionTrasEmpuje('delivered')).toBe('cobrar-enfriamiento');
  });

  it('deja pasar el empujon siguiente cuando la sesion estaba ocupada', () => {
    // El fallo que se decia antes: la sesion ocupada gastaba el enfriamiento y
    // el trabajo real se quedaba sinparable hasta que se cumplia el enfriamiento.
    const enfriamientoCobrado = cuentaComoEmpuje(classifyPush('Session already has an active Turn', 1));

    expect(enfriamientoCobrado).toBe(false);
  });
});