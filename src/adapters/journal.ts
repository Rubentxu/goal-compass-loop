/**
 * Journal durable del supervisor.
 *
 * Vive FUERA del repositorio analizado (`~/.local/state/goal-compass/<mission>/journal.json`)
 * para no ensuciar el proyecto ni dejar estado de ejecucion dentro del repo.
 *
 * Escritura atomica: temp file en el mismo directorio -> fsync -> rename -> fsync del dir.
 * Si el proceso muere a mitad, el journal sigue siendo valido (o el anterior intacto).
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Journal } from '../core/types.js';
import type { JournalPort } from '../ports.js';

/** Raiz del estado: `$XDG_STATE_HOME/goal-compass` o `~/.local/state/goal-compass`. */
export function stateRoot(): string {
  const xdg = process.env.XDG_STATE_HOME;
  const base = xdg && xdg.trim() ? xdg : join(homedir(), '.local', 'state');
  return join(base, 'goal-compass');
}

/** Ruta del journal de una mision. */
export function journalPath(missionId: string): string {
  return join(stateRoot(), missionId, 'journal.json');
}

export class FileJournal implements JournalPort {
  private readonly path: string;

  constructor(missionId: string) {
    this.path = journalPath(missionId);
  }

  get filePath(): string {
    return this.path;
  }

  async load(): Promise<Journal | null> {
    try {
      const raw = readFileSync(this.path, 'utf8');
      const parsed = JSON.parse(raw) as Journal;
      if (parsed.version !== 1) {
        throw new Error(`version de journal no soportada: ${String(parsed.version)}`);
      }
      return parsed;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async saveAtomically(journal: Journal): Promise<void> {
    const dir = dirname(this.path);
    mkdirSync(dir, { recursive: true });

    const tmp = `${this.path}.tmp-${process.pid}`;
    const payload = `${JSON.stringify(journal, null, 2)}\n`;

    const fd = openSync(tmp, 'w');
    try {
      writeFileSync(fd, payload, 'utf8');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }

    renameSync(tmp, this.path);

    // Durabilidad del rename: sincroniza tambien la entrada de directorio.
    try {
      const dirFd = openSync(dir, 'r');
      try {
        fsyncSync(dirFd);
      } finally {
        closeSync(dirFd);
      }
    } catch {
      /* fsync de directorio no disponible en todas las plataformas: no es fatal */
    }
  }
}
