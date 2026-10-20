---
id: investigate
role: agent
links:
  - to: probe
    rel: next
    when: falta prueba empírica
    evidence: experimento pequeño definido
  - to: plan
    rel: next
    when: conocimiento suficiente y cambio grande
    evidence: restricción principal aclarada
  - to: implement
    rel: next
    when: trabajo mínimo ya definido
    evidence: comportamiento deseado
  - to: finish
    rel: complete
    when: la investigación era el objetivo y está sustentada
    evidence: fuentes y conclusión
  - to: unblock
    rel: recover
    when: no hay fuentes fiables
    evidence: vacío de evidencia
---

# investigate · Conocimiento insuficiente

## Cuándo entrar

Una API, arquitectura, comportamiento o hipótesis clave se desconoce; no hay evidencia primaria suficiente.

## Preguntas

1. ¿Qué afirmación concreta falta comprobar?
2. ¿Qué código, contrato o fuente primaria la confirma o refuta?
3. ¿Qué dato cambiaría nuestra siguiente decisión?

## Acción mínima

Leer la fuente primaria más cercana (firma, callsite, tests existentes, documentación oficial) y contrastar UNA hipótesis, sin generar un informe largo ni alterar código. Candidato externo: `research` (modelo), si está disponible.

## Criterio de salida

Citar origen y separar hecho/hipótesis/información faltante.
