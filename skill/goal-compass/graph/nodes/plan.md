---
id: plan
role: agent
links:
  - to: investigate
    rel: next
    when: falta requisito técnico imprescindible
    evidence: pregunta concreta
  - to: probe
    rel: next
    when: arquitectura incierta y comprobable
    evidence: spike delimitado
  - to: implement
    rel: next
    when: primer bloque acordado
    evidence: criterio de éxito
  - to: unblock
    rel: recover
    when: bloqueos entre dependencias
    evidence: causa y dueño
  - to: stop
    rel: escalate
    when: requiere decisión humana indispensable
    evidence: pregunta única
---

# plan · Plan acotado

## Cuándo entrar

Varias dependencias reales impiden un cambio inmediato; no usar para reparos simples.

## Preguntas

1. ¿Qué incertidumbre impide entregar un primer valor?
2. ¿Cuál es la rebanada independiente más pequeña?
3. ¿Qué decisión necesita a una persona?

## Acción mínima

Describir un único bloque valioso, su evidencia de salida y dependencias. Para esfuerzos realmente nebulosos: sugerir `/wayfinder` (upstream marcado user-invoked); para spec/tickets manuales sugerir `/to-spec` y `/to-tickets`. No simular su ejecución.

## Criterio de salida

Primera rebanada viable con criterio de aceptación y límites.
