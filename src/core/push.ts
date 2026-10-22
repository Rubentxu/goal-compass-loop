/**
 * Que paso cuando la cadena se intenta empujar hacia su sesion.
 *
 * Empujar es hablarle a otra sesion viva desde fuera, y esa sesion no esta
 * siempre en condiciones de escuchar. Hay tres salidas reales, y confundirlas
 * es lo que hacia que el reloj pareciera roto: una sesion ocupada se contaba
 * como empujon fallido y gastaba el enfriamiento, de modo que el trabajo
 * genuineo se quedaba sinparable hasta media hora despues.
 */
export type PushOutcome =
  /** El mensaje entro y la sesion se puso a trabajar. */
  | 'delivered'
  /** La sesion esta ocupada con un turno propio; no hace falta empujarla ahora. */
  | 'session-busy'
  /** El empujon no llego a ninguna parte y habra que reintentarlo. */
  | 'failed';

/**
 * Lee lo que dijo el comando que empuja y decide que significo.
 *
 * Se decide por lo que dijo, no por el codigo de salida: el comando puede
 * entregar el mensaje y despues morir cerrando el runtime, asi que un codigo
 * distinto de cero no significa por si solo que nadie escucho.
 *
 * @param salida texto combinado del comando que empuja
 * @param codigo codigo de salida, o nulo si el proceso no llego a terminar
 */
export function classifyPush(salida: string, codigo: number | null): PushOutcome {
  const texto = salida.toLowerCase();

  if (texto.includes('already has an active turn')) return 'session-busy';
  if (codigo === 0) return 'delivered';
  return 'failed';
}

/** Como se cuenta un empujon en el journal. */
export function cuentaComoEmpuje(outcome: PushOutcome): boolean {
  return outcome === 'delivered';
}