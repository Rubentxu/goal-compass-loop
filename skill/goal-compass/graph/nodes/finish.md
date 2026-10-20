---
id: finish
role: agent
links:
  - to: choose-next
    rel: discover
    when: ACP confirmó complete y supervisor toma el control post-turn
    evidence: GoalId completado y candidatos
  - to: unblock
    rel: recover
    when: se descubre contradicción o regresión
    evidence: hecho nuevo
  - to: stop
    rel: escalate
    when: se descubre que no se puede sostener la prueba
    evidence: límite demostrado
---

# finish · Objetivo demostrado

## Cuándo entrar

La evidencia disponible satisface el criterio del **Goal actual**; pueden existir muchos otros Goals por descubrir dentro de la Mission.

## Preguntas

1. ¿Qué parte concreta quedó probada?
2. ¿Qué quedó sin verificar por quedar fuera del alcance?

## Acción mínima

Emitir recibo conciso: resultado, evidencia exacta, archivos/cambios relevantes, limitaciones. Completar el Goal y emitir recibo. El siguiente Goal es responsabilidad del supervisor, fuera del turno actual. No llamar create_goal desde aquí.

## Criterio de salida

Goal actual completado con evidencia; Mission se mantiene activa fuera del Goal.
