/**
 * Canal de control del usuario.
 *
 * Vive en `control.json`, junto al journal pero en un fichero aparte: el
 * supervisor es el unico escritor del journal, y el usuario el de este fichero.
 * Asi ninguna orden del usuario se pierde por una carrera de escrituras.
 */
import { readFileSync, writeFileSync, mkdirSync, renameSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { dirname } from 'node:path';
import type { MissionControl, MissionStatus } from '../core/types.js';
import { journalPath } from './journal.js';

/** Ruta del fichero de control de una mision. */
export function controlPath(missionId: string): string {
  return `${journalPath(missionId)}.control`;
}

export class FileControlPort {
  private readonly path: string;

  constructor(missionId: string) {
    this.path = controlPath(missionId);
  }

  get filePath(): string {
    return this.path;
  }

  async read(): Promise<MissionStatus | null> {
    try {
      const raw = readFileSync(this.path, 'utf8');
      const parsed = JSON.parse(raw) as MissionControl;
      if (!parsed || typeof parsed.status !== 'string') return null;
      return parsed.status;
    } catch {
      return null;
    }
  }

  /** Escribe la orden del usuario de forma atomica. */
  async write(status: MissionStatus, reason?: string): Promise<void> {
    const dir = dirname(this.path);
    mkdirSync(dir, { recursive: true });
    const payload: MissionControl = {
      status,
      ...(reason !== undefined ? { reason } : {}),
      updatedAt: new Date().toISOString(),
    };
    const tmp = `${this.path}.tmp-${process.pid}`;
    const fd = openSync(tmp, 'w');
    try {
      writeFileSync(fd, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, this.path);
  }
}
