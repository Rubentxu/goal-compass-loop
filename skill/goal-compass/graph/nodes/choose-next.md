---
id: choose-next
role: supervisor
links:
  - to: investigate
    rel: discover
    when: hay pista concreta que investigar para abrir trabajo
    evidence: hipótesis falsable
  - to: plan
    rel: next
    when: hay varios candidatos con prerequisitos inciertos
    evidence: lista de dependencias concreta
  - to: implement
    rel: next
    when: Supervisor ya creó Goal pequeño ejecutable
    evidence: GoalId distinto y status active
  - to: await-work
    rel: await
    when: no hay trabajo autorizado respaldado por evidencia
    evidence: backlog agotado y última inspección
  - to: unblock
    rel: recover
    when: hay trabajo pero está atascado
    evidence: bloqueo comprobado
  - to: stop
    rel: escalate
    when: existen restricciones de seguridad o control
    evidence: razón para intervención
---

# choose-next · Nuevo Goal para la misión

## Cuándo entrar

**Solo en fase de planificación del supervisor, DESPUÉS de confirmar `complete` por ACP `get`**, o al arrancar una Mission sin Goal actual. Nunca llamar a `create_goal` desde el modelo después de aceptar `update_goal`.

## Preguntas

1. ¿Qué resultado del Goal recién completado cambia las prioridades reales de la Mission?
2. ¿Qué trabajo **no hecho** está listo y aporta mayor valor con una prueba observable?
3. ¿Cuál es el Goal más pequeño que crea una evidencia útil y respeta permisos?

## Acción mínima

Elegir un único Candidate documentado con `candidateId`, `objective`, `doneWhen`, `evidenceRefs` y prerequisitos satisfechos. Proponerlo al supervisor, no afirmar que se creó. La creación **real** la ejecuta el cliente ACP después de validar estado y journal. Si no hay candidato, consultar `await-work`/`investigate` una vez con nueva evidencia, sin inventar tareas.

El trabajo elegible viene de dos fuentes, y en este orden:

1. **Backlog curado** — lo que el usuario declaró como prioritario. Mandan aquí.
2. **Evidencias del workspace** — pendientes marcados en el código y pruebas omitidas, con su ubicación exacta (`fichero:línea`). Solo entran cuando el backlog no ofrece nada.

Un candidato sin evidencia o sin criterio de cierre observable no es candidato: se descarta.

## Criterio de salida

Candidato nuevo, realizable, autorizado, no duplicado y verificable; o `parked` con motivo claro.
