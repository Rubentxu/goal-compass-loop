# hub · Página de inicio

**Self:** `index.md`. Este recurso descubre el primer nodo; abre UNO según señal actual. Nunca hay que recorrerlos todos. Si ya estás en una fase avanzada, entra directamente en ella.

## Señales para decidir

- Goal actual probado → `finish`; si el estado nativo pasó a `complete`, el **supervisor externo** entra en `choose-next` y crea un nuevo Goal.
- Sin evidencia suficiente o fuente incierta → `investigate`.
- Bug reproducible o fallo sospechado → `diagnose`.
- Pregunta de diseño que necesita experimento → `probe`.
- Alcance múltiple, dependencias y orden inciertos → `plan`.
- Implementación pequeña y seam reconocido → `implement`.
- Cambios preparados pero no validados → `verify`.
- Algo impide cualquier avance normal → `unblock`.
- Cambio demostrado y entrega autorizada → `deliver`.
- Se agotaron opciones seguras / falta autorización → `stop`.
- Goal anterior ya `complete` o no hay Goal inicial → `choose-next` (control ACP externo).
- Backlog agotado y nada nuevo descubrible → `await-work` (Mission viva).

## Enlaces

- [choose-next](nodes/choose-next.md) — rel=discover; si=Goal anterior complete confirmado por supervisor; evidencia=GoalId y estado duradero
- [await-work](nodes/await-work.md) — rel=await; si=no hay siguiente Goal elegible; evidencia=ausencia comprobada de candidatos

- [investigate](nodes/investigate.md) — rel=next; si=falta evidencia de fuente; evidencia=pregunta falsable y fuente candidata
- [diagnose](nodes/diagnose.md) — rel=next; si=hay fallo; evidencia=señal de fallo que observar
- [probe](nodes/probe.md) — rel=next; si=hipótesis necesita ejecución breve; evidencia=experimento propuesto
- [plan](nodes/plan.md) — rel=next; si=dependencias o alcance realmente inciertos; evidencia=siguiente rebanada definida
- [implement](nodes/implement.md) — rel=next; si=seam y cambio acotados; evidencia=comportamiento esperado
- [verify](nodes/verify.md) — rel=next; si=hay cambio sin prueba suficiente; evidencia=criterio de comprobación
- [unblock](nodes/unblock.md) — rel=recover; si=estancamiento real; evidencia=obstáculo observado
- [deliver](nodes/deliver.md) — rel=next; si=validación completada y entrega deseada; evidencia=resultado de gate
- [finish](nodes/finish.md) — rel=complete; si=objetivo ya demostrado; evidencia=prueba de éxito
- [stop](nodes/stop.md) — rel=escalate; si=permiso o límite insalvable; evidencia=bloqueo concreto

El grafo es autodirigido: no hay fases impuestas, score fingido ni autoridad superior en el recurso. El agente debe justificar el enlace elegido.
