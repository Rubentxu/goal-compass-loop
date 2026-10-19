# await-work · Misión viva en espera

## Cuándo entrar

No hay siguiente Goal elegible ni señal nueva para investigar. No equivale a éxito o fracaso de la Mission.

## Preguntas

1. ¿Qué cambio comprobable (issue, commit, respuesta, aprobación) abriría el próximo Goal?
2. ¿Es útil esperar en vez de gastar tokens sin nueva información?

## Acción mínima

Registrar `MissionStatus=parked` con motivo y fuente observada. Devolver control; supervisor espera notificación, orden humana o revisión externa configurada. No sondear continuamente al modelo ni inventar trabajo.

## Criterio de salida

La misión persiste, reanudable; ninguna creación ni consumo LLM hasta nueva evidencia.

## Enlaces

- [choose-next](choose-next.md) — rel=discover; si=aparecen nuevas señales o instrucciones válidas; evidencia=candidato elegible nuevo
- [unblock](unblock.md) — rel=recover; si=desaparece dependencia y queda tarea pendiente; evidencia=desbloqueo verificable
- [stop](stop.md) — rel=escalate; si=usuario cancela o revoca autorización; evidencia=orden explícita
