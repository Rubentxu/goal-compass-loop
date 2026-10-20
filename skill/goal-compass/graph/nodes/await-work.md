---
id: await-work
role: supervisor
links:
  - to: choose-next
    rel: discover
    when: aparecen nuevas señales o instrucciones válidas
    evidence: candidato elegible nuevo
  - to: unblock
    rel: recover
    when: desaparece dependencia y queda tarea pendiente
    evidence: desbloqueo verificable
  - to: stop
    rel: escalate
    when: usuario cancela o revoca autorización
    evidence: orden explícita
---

# await-work · Misión viva en espera

## Cuándo entrar

No hay siguiente Goal elegible ni señal nueva para investigar. No equivale a éxito o fracaso de la Mission.

## Preguntas

1. ¿Qué cambio comprobable (issue, commit, respuesta, aprobación) abriría el próximo Goal?
2. ¿Es útil esperar en vez de gastar tokens sin nueva información?

## Acción mínima

Registrar `MissionStatus=parked` con motivo y fuente observada. Devolver control; supervisor espera notificación, orden humana o revisión externa configurada. No sondear continuamente al modelo ni inventar trabajo.

La misión se reanuda sola cuando aparece trabajo nuevo: un candidato añadido al fichero de misión, un pendiente nuevo en el código o la orden de continuar del usuario.

## Criterio de salida

La misión persiste, reanudable; ninguna creación ni consumo LLM hasta nueva evidencia.
