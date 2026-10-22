/**
 * Drift: la documentacion que ya no describe el repositorio.
 *
 * Un repositorio tiene dos verdades —el codigo y lo que se dice de el— y
 * cualquier lista de trabajo las compara: una referencia a un fichero que ya no
 * esta es trabajo de verdad, porque o el fichero falta o la documentacion
 * miente, y las dos cosas se arreglan.
 *
 * El detector es **deliberadamente estrecho**, porque aqui el coste de equivocarse
 * es alto: la senal se convierte en un objetivo de agente, y un objetivo
 * inventado quema un turno entero persiguiendo algo que no existe. Por eso:
 *
 *  - Solo se miran **enlaces de markdown**, que son afirmaciones comprobables
 *    ("este fichero existe"). El texto suelto no se mira: un documento que
 *    escribe `src/ejemplo.ts` para explicar como se escribe una referencia esta
 *    contando algo, no diciendo que el fichero este ahi. Y un ejemplo dentro de
 *    un bloque de codigo es un ejemplo, no una afirmacion.
 *  - Solo se miran los **enlaces a ficheros del proyecto**, no los http.
 *  - La ruta se resuelve **primero respecto al documento** y despues respecto a
 *    la raiz del workspace, que es como se leen las referencias de verdad.
 *  - Un enlace que apunta a un **ancla** que no existe tambien es drift: el
 *    proyecto usa anclas explicitas (`<a id="p1"></a>`) y una referencia a una
 *    seccion que ya no esta es tan rota como una a un fichero que no esta.
 *
 * Lo que este detector no dice es que no haya drift: dice que no ha encontrado
 * drift *por esta via*. Un repositorio cuya documentacion esta al dia no
 * produce ninguna senal, y eso es lo correcto: no hay trabajo que ofrecer.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { anchorExists } from './declaration-audit.js';

/** Que es lo que falta de una referencia. */
export type DriftKind = 'fichero' | 'ancla';

/** Una referencia que no lleva a ninguna parte. */
export interface DriftSignal {
  /** Donde esta la referencia: `docs/roadmap.md:42`. */
  location: string;
  /** La referencia tal cual, con su ancla si la tiene. */
  target: string;
  /** Que es lo que no se encuentra. */
  missing: DriftKind;
  /** Texto de la senal, recortado. */
  summary: string;
}

export interface DriftOptions {
  /** Tope de documentos leidos. */
  maxFiles?: number;
  /** Tope de senales devueltas. */
  maxSignals?: number;
  /** Tope de bytes por documento; los mayores se ignoran. */
  maxFileBytes?: number;
}

const DEFAULT_MAX_FILES = 2_000;
const DEFAULT_MAX_SIGNALS = 25;
const DEFAULT_MAX_FILE_BYTES = 1024 * 1024;

/** Un enlace de markdown: `[texto](destino)`. El destino no lleva espacios. */
const MARKDOWN_LINK = /\[(?:[^\]\\]|\\.)*\]\(([^)\s]+)\)/g;

/** Un enlace a http, a un correo o a otro protocolo: no se comprueba. */
const REMOTE_TARGET = /^[a-z][a-z0-9+.-]*:/i;

/** Directorios que no aportan documentacion propia del proyecto. */
const IGNORED_DIRECTORIES = new Set([
  'node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out', 'coverage',
  'target', 'vendor', '__pycache__', '.venv', 'venv', '.tox', '.next', '.nuxt',
  '.cache', '.mypy_cache', '.pytest_cache', '.gradle', '.idea', '.vscode',
]);

/**
 * Busca referencias rotas en la documentacion del workspace.
 *
 * El recorrido es determinista —mismo workspace -> mismas senales— y esta
 * acotado, para que un repositorio grande no se convierta en una espera
 * interminable.
 */
export class DocumentationScanner {
  private readonly maxFiles: number;
  private readonly maxSignals: number;
  private readonly maxFileBytes: number;

  constructor(options: DriftOptions = {}) {
    this.maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
    this.maxSignals = options.maxSignals ?? DEFAULT_MAX_SIGNALS;
    this.maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  }

  /** Recorre la documentacion y devuelve las referencias rotas, en orden estable. */
  async scan(workspace: string): Promise<DriftSignal[]> {
    const found: DriftSignal[] = [];
    let inspected = 0;

    for (const file of this.listDocuments(workspace)) {
      if (inspected >= this.maxFiles || found.length >= this.maxSignals) break;
      inspected += 1;

      const content = this.readFile(file);
      if (content === null) continue;

      const lines = content.split('\n');
      let inFence = false;
      for (let index = 0; index < lines.length; index += 1) {
        if (found.length >= this.maxSignals) break;
        const line = lines[index]!;

        // Un bloque de codigo es un ejemplo, no una afirmacion: lo que hay
        // dentro no dice nada sobre el estado del repositorio.
        if (/^\s*(?:```|~~~)/.test(line)) {
          inFence = !inFence;
          continue;
        }
        if (inFence) continue;

        // El codigo en linea tampoco afirma nada: es la manera de escribir un
        // ejemplo sin que parezca una referencia.
        const limpio = line.replace(/`[^`]*`/g, '');
        const location = `${this.relativeTo(workspace, file)}:${index + 1}`;

        for (const target of targetsOf(limpio)) {
          const signal = this.check(workspace, file, content, location, target);
          if (signal) {
            found.push(signal);
            if (found.length >= this.maxSignals) break;
          }
        }
      }
    }

    return found;
  }

  /**
   * Comprueba una referencia: el fichero tiene que estar y el ancla, si la hay,
   * tambien.
   */
  private check(
    workspace: string,
    document: string,
    content: string,
    location: string,
    target: string,
  ): DriftSignal | null {
    if (REMOTE_TARGET.test(target)) return null;

    const hash = target.indexOf('#');
    const path = hash === -1 ? target : target.slice(0, hash);
    const anchor = hash === -1 ? '' : target.slice(hash + 1);

    // Un enlace solo con ancla apunta dentro del propio documento.
    if (path === '') {
      if (anchorExists(content, anchor)) return null;
      return {
        location,
        target,
        missing: 'ancla',
        summary: `el ancla "${anchor}" no existe en ${this.relativeTo(workspace, document)}`,
      };
    }

    if (isAbsolute(path)) return null;

    // La ruta se resuelve primero respecto al documento: es como la lee quien
    // escribe, y luego respecto a la raiz del workspace.
    const resolved = this.resolve(workspace, document, path);
    if (!resolved) {
      return {
        location,
        target,
        missing: 'fichero',
        summary: `la referencia "${target}" no apunta a ningun fichero`,
      };
    }

    if (anchor !== '' && resolved.endsWith('.md')) {
      const targetContent = this.readFile(resolved);
      if (targetContent !== null && !anchorExists(targetContent, anchor)) {
        return {
          location,
          target,
          missing: 'ancla',
          summary: `el ancla "${anchor}" no existe en ${this.relativeTo(workspace, resolved)}`,
        };
      }
    }

    return null;
  }

  /** Busca el fichero al que apunta una referencia, o `null` si no esta. */
  private resolve(workspace: string, document: string, path: string): string | null {
    const desdeElDocumento = resolve(dirname(document), path);
    if (this.exists(desdeElDocumento)) return desdeElDocumento;
    const desdeLaRaiz = resolve(workspace, path);
    if (this.exists(desdeLaRaiz)) return desdeLaRaiz;
    return null;
  }

  private exists(path: string): boolean {
    try {
      statSync(path);
      return true;
    } catch {
      return false;
    }
  }

  /** Los documentos markdown del workspace, en orden alfabetico estable. */
  private listDocuments(workspace: string): string[] {
    const files: string[] = [];
    const queue: string[] = [workspace];

    while (queue.length > 0) {
      const directory = queue.shift()!;
      let entries;
      try {
        entries = readdirSync(directory, { withFileTypes: true });
      } catch {
        continue;
      }

      const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of sorted) {
        const full = join(directory, entry.name);
        if (entry.isDirectory()) {
          if (IGNORED_DIRECTORIES.has(entry.name) || entry.name.startsWith('.')) continue;
          queue.push(full);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          files.push(full);
        }
      }
    }

    return files.sort();
  }

  private readFile(file: string): string | null {
    try {
      if (statSync(file).size > this.maxFileBytes) return null;
      return readFileSync(file, 'utf8');
    } catch {
      return null;
    }
  }

  /** La ruta del fichero respecto al workspace, con separadores de unix. */
  private relativeTo(workspace: string, file: string): string {
    return relative(workspace, file).split(sep).join('/');
  }
}

/** Los destinos de los enlaces de markdown de una linea, en orden. */
function targetsOf(line: string): string[] {
  const targets: string[] = [];
  MARKDOWN_LINK.lastIndex = 0;
  let match = MARKDOWN_LINK.exec(line);
  while (match !== null) {
    targets.push(match[1]!);
    match = MARKDOWN_LINK.exec(line);
  }
  return targets;
}
