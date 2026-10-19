# choose-next · Nuevo Goal para la misión

## Cuándo entrar

**Solo en fase de planificación del supervisor, DESPUÉS de confirmar `complete` por ACP `get`**, o al arrancar una Mission sin Goal actual. Nunca llamar a `create_goal` desde el modelo después de aceptar `update_goal`.

## Preguntas

1. ¿Qué resultado del Goal recién completado cambia las prioridades reales de la Mission?
2. ¿Qué trabajo **no hecho** está listo y aporta mayor valor con una prueba observable?
3. ¿Cuál es el Goal más pequeño que crea una evidencia útil y respeta permisos?

## Acción mínima

Elegir un único Candidate documentado con `candidateId`, `objective`, `doneWhen`, `evidenceRefs` y prerequisitos satisfechos. Proponerlo al supervisor, no afirmar que se creó. La creación **real** la ejecuta el cliente ACP después de validar estado y journal. Si no hay candidato, consultar `await-work`/`investigate` una vez con nueva evidencia, sin inventar tareas.

## Criterio de salida

Candidato nuevo, realizable, autorizado, no duplicado y verificable; o `parked` con motivo claro.

## Enlaces

- [investigate](investigate.md) — rel=discover; si=hay pista concreta que investigar para abrir trabajo; evidencia=hipótesis falsable
- [plan](plan.md) — rel=next; si=hay varios candidatos con prerequisitos inciertos; evidencia=lista de dependencias concreta
- [implement](implement.md) — rel=next; si=Supervisor ya creó Goal pequeño ejecutable; evidencia=GoalId distinto y status active
- [await-work](await-work.md) — rel=await; si=no hay trabajo autorizado respaldado por evidencia; evidencia=backlog agotado y última inspección
- [unblock](unblock.md) — rel=recover; si=hay trabajo pero está atascado; evidencia=bloqueo comprobado
- [stop](stop.md) — rel=escalate; si=existen restricciones de seguridad o control; evidencia=razón para intervención
