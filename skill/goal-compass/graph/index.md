---
id: index
role: agent
entry: true
links:
  - to: choose-next
    rel: discover
    when: Goal anterior complete confirmado por supervisor
    evidence: GoalId y estado duradero
  - to: await-work
    rel: await
    when: no hay siguiente Goal elegible
    evidence: ausencia comprobada de candidatos
  - to: investigate
    rel: next
    when: falta evidencia de fuente
    evidence: pregunta falsable y fuente candidata
  - to: diagnose
    rel: next
    when: hay fallo
    evidence: señal de fallo que observar
  - to: probe
    rel: next
    when: hipótesis necesita ejecución breve
    evidence: experimento propuesto
  - to: plan
    rel: next
    when: dependencias o alcance realmente inciertos
    evidence: siguiente rebanada definida
  - to: implement
    rel: next
    when: seam y cambio acotados
    evidence: comportamiento esperado
  - to: verify
    rel: next
    when: hay cambio sin prueba suficiente
    evidence: criterio de comprobación
  - to: unblock
    rel: recover
    when: estancamiento real
    evidence: obstáculo observado
  - to: deliver
    rel: next
    when: validación completada y entrega deseada
    evidence: resultado de gate
  - to: finish
    rel: complete
    when: objetivo ya demostrado
    evidence: prueba de éxito
  - to: stop
    rel: escalate
    when: permiso o límite insalvable
    evidence: bloqueo concreto
---

# hub · Página de inicio

**Self:** `index.md`. Este recurso descubre el primer nodo; abre UNO según señal actual. Nunca hay que recorrerlos todos. Si ya estás en una fase avanzada, entra directamente en ella.

Las salidas posibles están en la cabecera de este fichero: cada una dice a qué
nodo lleva, con qué relación, **cuándo** se toma y **con qué evidencia** se
sustenta. Elige una según la señal de ahora mismo y abre solo ese nodo.

El grafo es autodirigido: no hay fases impuestas, score fingido ni autoridad superior en el recurso. El agente debe justificar el enlace elegido.
