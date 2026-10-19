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

## Enlaces

- [choose-next](choose-next.md) — rel=discover; si=ACP confirmó complete y supervisor toma el control post-turn; evidencia=GoalId completado y candidatos

- [unblock](unblock.md) — rel=recover; si=se descubre contradicción o regresión; evidencia=hecho nuevo
- [stop](stop.md) — rel=escalate; si=se descubre que no se puede sostener la prueba; evidencia=límite demostrado
