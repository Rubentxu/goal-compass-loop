---
id: probe
role: agent
links:
  - to: investigate
    rel: next
    when: resultado requiere otra fuente
    evidence: nueva pregunta precisa
  - to: diagnose
    rel: next
    when: se obtuvo reproducción de fallo
    evidence: señal roja estable
  - to: implement
    rel: next
    when: experimento valida un seam práctico
    evidence: alcance mínimo
  - to: plan
    rel: next
    when: experimento indica decisiones amplias
    evidence: requisitos priorizados
  - to: unblock
    rel: recover
    when: experimento inviable o ambiguo
    evidence: razón y alternativa
---

# probe · Experimento de bajo coste

## Cuándo entrar

Una hipótesis técnica altera la elección, pero leer documentación no basta.

## Preguntas

1. ¿Qué dos posibilidades distingue el experimento?
2. ¿Cuál es el montaje más barato y reversible?
3. ¿Qué resultado refutaría la idea preferida?

## Acción mínima

Crear o ejecutar un único experimento efímero (repro CLI, fixture, spike aislado, diff diferencial) sin harness permanente. Candidato: `prototype` (modelo).

## Criterio de salida

Registrar entrada, salida, su interpretación limitada y qué hipótesis cambia.
