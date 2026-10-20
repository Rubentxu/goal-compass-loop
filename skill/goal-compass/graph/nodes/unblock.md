---
id: unblock
role: agent
links:
  - to: investigate
    rel: next
    when: falta información primaria
    evidence: fuente candidata
  - to: diagnose
    rel: next
    when: falla observable y se puede reproducir distinto
    evidence: nueva señal
  - to: probe
    rel: next
    when: alternativa falsable y barata
    evidence: experimento discriminante
  - to: plan
    rel: next
    when: reordenar dependencias permite avance
    evidence: rebanada sin bloqueo
  - to: implement
    rel: next
    when: hay trabajo seguro independiente
    evidence: cambio delimitado
  - to: stop
    rel: escalate
    when: todas las alternativas requieren permiso o recurso externo
    evidence: pregunta/dueño y trabajo que queda
---

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
