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
  /** La sesion ya no existe: empujarla es hablar al vacio. */
  | 'session-gone'
  /** El empujon no llego a ninguna parte y habra que reintentarlo. */
  | 'failed';

/**
 * Como se dice una sesion que ya no esta.
 *
 * El host lo dice de una manera: `Session not found: <id>`. Se acepta tambien
 * como no such session y unknown session, porque son las otras dos formas que
 * tiene el host de decirlo y no costaria nada reconocerlas.
 */
const SESION_MUERTA = ['session not found', 'no such session', 'unknown session'];

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
  if (SESION_MUERTA.some((frase) => texto.includes(frase))) return 'session-gone';
  if (codigo === 0) return 'delivered';
  return 'failed';
}

/** Como se cuenta un empujon en el journal. */
export function cuentaComoEmpuje(outcome: PushOutcome): boolean {
  return outcome === 'delivered';
}

/** Que hay que hacer con la sesion despues de un empujon. */
export type SesionTrasEmpuje =
  /** Cobrar el enfriamiento: la sesion se puso a trabajar. */
  | 'cobrar-enfriamiento'
  /** Soltar la sesion: ya no existe y empujarla es hablar al vacio. */
  | 'soltar-sesion'
  /** No hacer nada: la sesion esta ocupada o el fallo no dice nada. */
  | 'nada';

/**
 * Que hacer con la sesion segun como salio el empujon.
 *
 * Solo un empujon que entro de verdad enfrria la cadena. Una sesion ocupada
 * esta trabajando, y cobrarle el enfriamiento dejaria el trabajo de verdad
 * sinparable hasta media hora despues. Y una sesion que ya no existe hay
 * que soltarla: el reloj lo intentaria otra vez en cada vuelta, para siempre,
 * gastando un host cada vez en hablar con la nada.
 */
export function sesionTrasEmpuje(outcome: PushOutcome): SesionTrasEmpuje {
  if (outcome === 'delivered') return 'cobrar-enfriamiento';
  if (outcome === 'session-gone') return 'soltar-sesion';
  return 'nada';
}