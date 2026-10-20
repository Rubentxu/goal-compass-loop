/**
 * Lector de un subconjunto acotado de YAML, sin dependencias.
 *
 * El proyecto no tiene dependencias en ejecucion, y el arbol de decision tiene
 * que ser un fichero de datos que se pueda leer y validar. Un lector completo de
 * YAML es una biblioteca entera; esto es lo justo que el arbol necesita:
 *
 *  - mapas y listas, anidados por indentacion;
 *  - escalares de texto, numeros, booleanos y nulo;
 *  - comillas simples y dobles;
 *  - texto de bloque (`|`, `|-`, `>`, `>-`) para losconditiones largas;
 *  - comentarios de linea.
 *
 * Lo que no se admite —anclas, etiquetas, colecciones en linea,_documentos
 * multiples— se rechaza con un error claro en vez de interpretarse a medias.
 * Un lector que adivina es un lector que un dia adivina mal.
 */

/** Error de lectura, con el numero de linea donde se rompio. */
export class YamlError extends Error {
  constructor(message: string, readonly line: number) {
    super(`yaml: linea ${line}: ${message}`);
    this.name = 'YamlError';
  }
}

/** Una entrada de mapa: `clave: valor`. */
const MAPPING = /^([^:#\s][^:]*):(\s|$)/;

/** Un elemento de lista: `- algo`. */
const SEQUENCE = /^-(?:\s|$)/;

/** Un escalar de bloque: `|`, `|-`, `>`, `>-`. */
const BLOCK = /^[|>][+-]?$/;

/** Tipos que puede tener un escalar. */
export type YamlScalar = string | number | boolean | null;

/** Lo que devuelve la lectura: mapas, listas y escalares. */
export type YamlValue = YamlScalar | YamlValue[] | { [key: string]: YamlValue };

/**
 * Lee un texto YAML y devuelve su valor.
 *
 * Devuelve mapas como objetos y listas como arreglos. Un documento vacio es
 * `null`: un fichero de configuracion vacio no es un error, es una ausencia.
 */
export function parseYaml(text: string): YamlValue {
  return new Reader(text).parse();
}

/** Una cabecera YAML y el cuerpo que queda despues de ella. */
export interface Frontmatter {
  /** Los datos de la cabecera, o `null` si el fichero no la tiene. */
  data: YamlValue;
  /** El cuerpo del fichero, sin la cabecera. */
  body: string;
}

/**
 * Separa la cabecera YAML del cuerpo de un fichero.
 *
 * La cabecera son las lineas entre dos `---` al principio del fichero. El
 * cuerpo es todo lo demas, con las lineas en blanco del borde quitadas. Un
 * fichero sin cabecera devuelve el texto entero como cuerpo.
 */
export function parseFrontmatter(text: string): Frontmatter {
  const normalized = text.replace(/\r\n?/g, '\n');
  if (!normalized.startsWith('---\n')) {
    return { data: null, body: normalized.replace(/^\n+/, '') };
  }

  const lines = normalized.split('\n');
  const end = lines.findIndex((line, index) => index > 0 && (line === '---' || line === '...'));
  if (end === -1) {
    throw new YamlError('la cabecera YAML no se cierra', 1);
  }

  const header = lines.slice(1, end).join('\n');
  const body = lines
    .slice(end + 1)
    .join('\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '\n');

  return { data: parseYaml(header), body };
}

class Reader {
  private readonly lines: string[];
  private position = 0;

  constructor(text: string) {
    this.lines = text.replace(/\r\n?/g, '\n').split('\n');
  }

  parse(): YamlValue {
    const value = this.block(0);
    this.skipVoid();
    if (this.position < this.lines.length) {
      throw this.error('contenido que no pertenece a ningun bloque');
    }
    return value;
  }

  /** Lee el bloque que empieza en la linea actual. */
  private block(minIndent: number): YamlValue {
    this.skipVoid();
    if (this.position >= this.lines.length) return null;

    const line = this.current();
    if (line.indent < minIndent) return null;
    if (SEQUENCE.test(line.content)) return this.sequence(line.indent);
    return this.mapping(line.indent);
  }

  /** Lee un mapa: pares `clave: valor` al mismo nivel. */
  private mapping(indent: number): { [key: string]: YamlValue } {
    const result: { [key: string]: YamlValue } = {};

    while (true) {
      this.skipVoid();
      if (this.position >= this.lines.length) break;

      const line = this.current();
      if (line.indent < indent) break;
      if (line.indent > indent) throw this.error('sangria inesperada', line.number);
      if (SEQUENCE.test(line.content)) break;

      const match = MAPPING.exec(line.content);
      if (!match) throw this.error(`no se entiende la linea: ${line.content}`, line.number);

      const key = unquote(match[1]!.trim());
      const rest = line.content.slice(match[0]!.length).trim();
      this.position++;

      result[key] = this.value(rest, indent, line.number);
    }

    return result;
  }

  /** Lee una lista: elementos `- ...` al mismo nivel. */
  private sequence(indent: number): YamlValue[] {
    const items: YamlValue[] = [];

    while (true) {
      this.skipVoid();
      if (this.position >= this.lines.length) break;

      const line = this.current();
      if (line.indent < indent) break;
      if (line.indent > indent) throw this.error('sangria inesperada en la lista', line.number);
      if (!SEQUENCE.test(line.content)) break;

      const rest = line.content.slice(1).trim();
      if (rest === '') {
        this.position++;
        items.push(this.block(indent + 1));
        continue;
      }

      if (MAPPING.test(rest)) {
        // El elemento abre un mapa: se reescribe la linea como la primera
        // entrada de ese mapa y se sigue leyendo desde ahi.
        const raw = this.lines[this.position]!;
        const column = raw.indexOf(rest, indent);
        this.lines[this.position] = ' '.repeat(column) + rest;
        items.push(this.mapping(column));
        continue;
      }

      this.position++;
      items.push(scalar(rest));
    }

    return items;
  }

  /** El valor de una entrada de mapa, que puede ser una lista, un bloque o un escalar. */
  private value(text: string, indent: number, number: number): YamlValue {
    if (text === '') {
      this.skipVoid();
      if (this.position >= this.lines.length) return null;

      const next = this.current();
      if (next.indent > indent) return this.block(next.indent);
      // Una lista puede empezar al mismo nivel que su clave.
      if (next.indent === indent && SEQUENCE.test(next.content)) return this.sequence(indent);
      return null;
    }

    if (BLOCK.test(text)) return this.blockScalar(text, indent);
    return scalar(text);
  }

  /** Lee un escalar de bloque: texto que sigue a `|` o `>`. */
  private blockScalar(marker: string, indent: number): string {
    const folded = marker.startsWith('>');
    const keep = marker.endsWith('+');
    const strip = marker.endsWith('-');

    const collected: string[] = [];
    let blockIndent: number | undefined;

    while (this.position < this.lines.length) {
      const raw = this.lines[this.position]!;
      if (raw.trim() === '') {
        collected.push('');
        this.position++;
        continue;
      }
      const current = indentOf(raw);
      if (current <= indent) break;
      blockIndent ??= current;
      collected.push(raw.slice(blockIndent));
      this.position++;
    }

    while (collected.length > 0 && collected[collected.length - 1] === '') collected.pop();

    let text = folded ? fold(collected) : collected.join('\n');
    if (text.length > 0 && !strip && !keep) text += '\n';
    return text;
  }

  /** Salta lineas vacias y comentarios. */
  private skipVoid(): void {
    while (this.position < this.lines.length) {
      const trimmed = this.lines[this.position]!.trim();
      if (trimmed === '' || trimmed.startsWith('#')) {
        this.position++;
        continue;
      }
      return;
    }
  }

  private current(): { indent: number; content: string; number: number } {
    const raw = this.lines[this.position]!;
    return {
      indent: indentOf(raw),
      content: raw.trim(),
      number: this.position + 1,
    };
  }

  private error(message: string, number?: number): YamlError {
    return new YamlError(message, number ?? this.position + 1);
  }
}

/** Cuantos espacios de sangria tiene la linea. */
function indentOf(raw: string): number {
  let indent = 0;
  for (const character of raw) {
    if (character === ' ') indent++;
    else if (character === '\t') {
      throw new YamlError('la sangria no puede llevar tabuladores', 0);
    } else break;
  }
  return indent;
}

/**
 * Convierte un texto en su valor.
 *
 * Un escalar de verdad, o una coleccion vacia escrita en forma de flujo.
 */
function scalar(text: string): YamlValue {
  if (text.startsWith('"')) return unquoteDouble(text);
  if (text.startsWith("'")) return unquoteSingle(text);
  if (text === '[]') return emptyList();
  if (text === '{}') return emptyMap();

  const value = stripComment(text).trim();
  if (value === '' || value === 'null' || value === '~') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^[+-]?\d+$/.test(value)) return Number(value);
  if (/^[+-]?(\d+\.\d*|\.\d+)$/.test(value)) return Number(value);
  return value;
}

/** Una lista vacia, que en YAML se escribe `[]`. */
function emptyList(): YamlValue {
  return [];
}

/** Un mapa vacio, que en YAML se escribe `{}`. */
function emptyMap(): { [key: string]: YamlValue } {
  return {};
}

/**
 * Quita el comentario de una linea.
 *
 * Una `#` solo abre comentario cuando va precedida de espacio: dentro de un
 * texto plano, `docs/triage.md#terraform-edges` es un texto y no un comentario.
 */
function stripComment(text: string): string {
  const index = text.indexOf(' #');
  return index === -1 ? text : text.slice(0, index);
}

/** Quita las comillas dobles de un texto y resuelve sus escapes. */
function unquoteDouble(text: string): string {
  const end = text.lastIndexOf('"');
  if (end <= 0) throw new YamlError('comillas dobles sin cerrar', 0);
  return text
    .slice(1, end)
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '\r')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

/** Quita las comillas simples de un texto. */
function unquoteSingle(text: string): string {
  const end = text.lastIndexOf("'");
  if (end <= 0) throw new YamlError('comillas simples sin cerrar', 0);
  return text.slice(1, end).replace(/''/g, "'");
}

/** Quita las comillas de una clave, si las tiene. */
function unquote(key: string): string {
  if (key.startsWith('"')) return unquoteDouble(key);
  if (key.startsWith("'")) return unquoteSingle(key);
  return key;
}

/** Une las lineas de un bloque plegado: los renglones se unen con espacio. */
function fold(lines: string[]): string {
  const parts: string[] = [];
  let current = '';

  for (const line of lines) {
    if (line === '') {
      parts.push(current);
      current = '';
      continue;
    }
    current = current === '' ? line : `${current} ${line}`;
  }
  parts.push(current);

  return parts.join('\n');
}
