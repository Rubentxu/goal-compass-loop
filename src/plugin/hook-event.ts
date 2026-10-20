/**
 * El evento que el host entrega al hook.
 *
 * Todos los hooks del plugin reciben lo mismo: el nombre del evento, la
 * sesion, el directorio de trabajo y un payload que depende del evento.
 */
export interface HookEvent {
  hook_event_name?: string;
  session_id?: string;
  cwd?: string;
  payload?: {
    stop_hook_active?: boolean;
    last_assistant_message?: string;
    [key: string]: unknown;
  };
}

/** Interpreta el evento que el host entrega por la entrada estandar. */
export function parseHookEvent(raw: string): HookEvent | null {
  if (!raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as HookEvent;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}
