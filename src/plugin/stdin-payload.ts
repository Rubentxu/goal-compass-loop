/**
 * La carga del hook se lee SIN esperar al fin de la entrada.
 *
 * El host escribe la carga en la entrada estandar y **no la cierra**: la deja
 * abierta para el proceso vivo. Esperar al fin —como hacia
 * `for await (const chunk of process.stdin)`— es esperar un fin que no llega,
 * el hook se pasa el margen del host y lo matan, y el turno se queda sin
 * continuacion. Ese fue el fallo que impedia que la cadena encadenara sola:
 * el hook respondia en milisegundos cuando se le cerraba la entrada, y se
 * quedaba mudo —hasta que lo mataban— cuando se la dejaba abierta, que es
 * justo lo que hace el host.
 *
 * La carga es JSON, asi que esta COMPLETA en cuanto parsea. Se lee hasta que
 * parsea; el fin de la entrada tambien vale, porque un host que si la cierra
 * no debe romperse nada.
 */

/**
 * Margen para la lectura de la carga. Es corto a proposito: el host escribe
 * la carga en cuanto arranca el hook, y el margen del host (diez segundos)
 * es para el TRABAJO del hook, no para leer su entrada. Si la carga no llega
 * en este tiempo, el hook dice que no hay nada que encadenar y se acaba: un
 * hook que se pasa su margen es peor que un hook que no encadena.
 */
export const STDIN_READ_DEADLINE_MS = 2_000;

/**
 * Lee la carga del hook de la entrada estandar.
 *
 * @param timeoutMs Margen para la lectura. Pasado ese tiempo, la promesa se
 * rechaza: no hay carga, y no hay nada que hacer.
 * @returns La carga, tal cual la escribio el host.
 */
export async function readStdinPayload(timeoutMs: number): Promise<string> {
    const chunks: Buffer[] = [];
    return new Promise<string>((resolve, reject) => {
        let timer: NodeJS.Timeout | undefined;
        const settle = (error?: Error): void => {
            if (timer) clearTimeout(timer);
            if (error) reject(error);
            else resolve(Buffer.concat(chunks).toString('utf8'));
        };
        const onData = (chunk: Buffer | string): void => {
            chunks.push(Buffer.from(chunk));
            try {
                // La carga esta completa cuando parsea. Un JSON a medias no
                // parsea, asi que esta comprobacion no puede dar un falso
                // positivo por un trozo que aun no llego.
                JSON.parse(Buffer.concat(chunks).toString('utf8'));
                settle();
            } catch {
                // Todavia no esta completa: se sigue leyendo.
            }
        };
        const onEnd = (): void => settle();
        const onError = (error: Error): void => settle(error);

        timer = setTimeout(
            () => settle(new Error(`la carga del hook no llego en ${timeoutMs} ms`)),
            timeoutMs,
        );
        process.stdin.on('data', onData);
        process.stdin.on('end', onEnd);
        process.stdin.on('error', onError);
    });
}
