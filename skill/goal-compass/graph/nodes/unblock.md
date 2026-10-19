# unblock · Cambio de estrategia

## Cuándo entrar

La acción previa no dio progreso, hay dependencia externa, falta de permiso, falta observabilidad o contradicción.

## Preguntas

1. ¿Qué clase de bloqueo es: conocimiento, reproducción, diseño, permisos o entorno?
2. ¿Qué experimento nuevo cambiaría la información sin repetir el fallido?
3. ¿Qué parte útil se puede continuar independientemente?

## Acción mínima

Enumerar máximo DOS alternativas distintas; priorizar prueba reversible y mínima. Si el mismo intento ya ocurrió dos veces sin información nueva, NO repetirlo. Si permiso humano indispensable, una sola pregunta concreta. Candidatos `domain-modeling`, `grilling`, `wizard` solo si disponibles y apropiados.

## Criterio de salida

Se identifica alternativa operable o se detiene con dueño del bloqueo y siguiente condición externa.

## Enlaces

- [investigate](investigate.md) — rel=next; si=falta información primaria; evidencia=fuente candidata
- [diagnose](diagnose.md) — rel=next; si=falla observable y se puede reproducir distinto; evidencia=nueva señal
- [probe](probe.md) — rel=next; si=alternativa falsable y barata; evidencia=experimento discriminante
- [plan](plan.md) — rel=next; si=reordenar dependencias permite avance; evidencia=rebanada sin bloqueo
- [implement](implement.md) — rel=next; si=hay trabajo seguro independiente; evidencia=cambio delimitado
- [stop](stop.md) — rel=escalate; si=todas las alternativas requieren permiso o recurso externo; evidencia=pregunta/dueño y trabajo que queda
