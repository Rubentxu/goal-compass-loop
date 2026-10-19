/**
 * Descubrimiento de trabajo pendiente a partir del workspace.
 *
 * Lee lo que ya esta en el repositorio (marcadores de pendiente y pruebas
 * omitidas) y lo convierte en candidatos con evidencia observable. No inventa
 * trabajo: si el repositorio no dice nada, no hay candidatos.
 *
 * El recorrido es determinista (mismo workspace -> mismos candidatos) y esta
 * acotado, para que un repositorio grande no se convierta en una espera
 * interminable.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** Tipos de senal que el escaner sabe leer. */
export type EvidenceKind = 'pending-marker' | 'skipped-test';

/** Una senal concreta localizada en el workspace. */
export interface Evidence {
  kind: EvidenceKind;
  /** Ubicacion relativa al workspace, con linea: `src/parser.ts:42`. */
  location: string;
  /** Texto de la senal, recortado. */
  summary: string;
  /** Objetivo que se puede pedir al agente. */
  objective: string;
  /** Criterio observable de cierre. */
  doneWhen: string[];
}

// El marcador tiene que abrir la linea (opcionalmente tras un signo de
// comentario). Asi un texto que menciona el marcador como dato no se confunde
// con un pendiente real.
const PENDING_MARKER = /^\s*(?:\/\/|#|\*|\/\*)?\s*(TODO|FIXME|XXX|HACK)\b[: ]?\s*(.*)$/;
const SKIPPED_TEST =
  /\b(?:it|test|describe)\.skip\s*\(|\b(?:xit|xtest|xdescribe)\s*\(|\b(?:it|test)\.todo\s*\(/;

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.java',
  '.kt', '.kts', '.rb', '.php', '.c', '.h', '.cc', '.cpp', '.hpp', '.cs', '.swift',
  '.scala', '.sh', '.bash', '.sql', '.vue', '.svelte',
]);

const IGNORED_DIRECTORIES = new Set([
  'node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out', 'coverage',
  'target', 'vendor', '__pycache__', '.venv', 'venv', '.tox', '.next', '.nuxt',
  '.cache', '.mypy_cache', '.pytest_cache', '.gradle', '.idea', '.vscode',
]);

export interface ScannerOptions {
  /** Tope de ficheros leidos en un recorrido. */
  maxFiles?: number;
  /** Tope de senales devueltas. */
  maxEvidence?: number;
  /** Tope de bytes por fichero; los mayores se ignoran. */
  maxFileBytes?: number;
}

const DEFAULT_MAX_FILES = 5_000;
const DEFAULT_MAX_EVIDENCE = 25;
const DEFAULT_MAX_FILE_BYTES = 512 * 1024;

/** Localiza señales de trabajo pendiente en un workspace. */
export class WorkspaceEvidenceScanner {
  private readonly maxFiles: number;
  private readonly maxEvidence: number;
  private readonly maxFileBytes: number;

  constructor(options: ScannerOptions = {}) {
    this.maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
    this.maxEvidence = options.maxEvidence ?? DEFAULT_MAX_EVIDENCE;
    this.maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  }

  /** Recorre el workspace y devuelve las señales encontradas, en orden estable. */
  async scan(workspace: string): Promise<Evidence[]> {
    const found: Evidence[] = [];
    let inspected = 0;

    for (const file of this.listSourceFiles(workspace)) {
      if (inspected >= this.maxFiles || found.length >= this.maxEvidence) break;
      inspected += 1;

      const content = this.readFile(file);
      if (content === null) continue;

      const lines = content.split('\n');
      for (let index = 0; index < lines.length; index += 1) {
        if (found.length >= this.maxEvidence) break;
        const line = lines[index]!;
        const location = `${relative(workspace, file).split(sep).join('/')}:${index + 1}`;

        const skipped = SKIPPED_TEST.exec(line);
        if (skipped) {
          found.push({
            kind: 'skipped-test',
            location,
            summary: line.trim().slice(0, 160),
            objective: `Activar la prueba omitida en ${location} y hacerla pasar`,
            doneWhen: [
              `La prueba omitida en ${location} se ejecuta y termina en verde`,
              'La suite completa sigue en verde',
            ],
          });
          continue;
        }

        const marker = PENDING_MARKER.exec(line);
        if (marker) {
          const detail = (marker[2] ?? '').trim().slice(0, 160);
          found.push({
            kind: 'pending-marker',
            location,
            summary: detail || line.trim().slice(0, 160),
            objective:
              `Resolver el pendiente marcado en ${location}` +
              (detail ? `: ${detail}` : ''),
            doneWhen: [
              `El pendiente de ${location} deja de estar marcado y su trabajo queda hecho`,
              'No se introduce ninguna regresión en el comportamiento afectado',
            ],
          });
        }
      }
    }

    return found;
  }

  /** Ficheros de codigo del workspace, en orden alfabetico estable. */
  private listSourceFiles(workspace: string): string[] {
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
        } else if (entry.isFile()) {
          if (CODE_EXTENSIONS.has(extensionOf(entry.name))) files.push(full);
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
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot).toLowerCase();
}
