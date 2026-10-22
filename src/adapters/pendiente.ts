/**
 * Que trabajo sigue pendiente, y por que otro no.
 *
 * Un trabajo deja de estar pendiente por dos motivos distintos: porque ya se
 * ejecuto, o porque el proyecto cerro la parte de trabajo que lo respalda.
 *
 * Los dos canales por donde llega el trabajo —el backlog declarado y las
 * propuestas de la sesion— tienen que aplicar la misma regla. Si cada uno
 * aplica la suya, el menu de trabajo anuncia trabajo que el proyecto ya dio
 * por hecho, y la cadena vuelve a pagar lo que ya estaba pagado.
 */
import { isCompleted, type CompletedObjectives } from './ledger.js';
import { evidenceSectionClosed } from './roadmap.js';

/** Por que un trabajo deja de estar pendiente. */
export type MotivoDescarte = 'ya-completado' | 'seccion-cerrada';

/** Lo que hace falta para decidir si un trabajo sigue pendiente. */
export interface ContextoPendiente {
  /** Donde vive el proyecto: ahi se busca el roadmap. */
  workspace: string;
  /** Lo que ya se ejecuto. */
  completed: CompletedObjectives;
}

/**
 * El motivo por el que un trabajo no se ofrece, o ninguno si sigue pendiente.
 *
 * Devolver el motivo y no un si o un no permite que quien lo pregunte diga
 * por que se descarta, que es la mitad del valor de un menu de trabajo.
 */
export function motivoParaDejarDeOfrecer(
  trabajo: { objective: string; evidenceRefs: string[] },
  ctx: ContextoPendiente,
): MotivoDescarte | undefined {
  if (isCompleted(ctx.completed, trabajo.objective)) return 'ya-completado';
  if (evidenceSectionClosed(ctx.workspace, trabajo.evidenceRefs)) return 'seccion-cerrada';
  return undefined;
}
