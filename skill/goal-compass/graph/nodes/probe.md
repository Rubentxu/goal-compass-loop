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

## Enlaces

- [investigate](investigate.md) — rel=next; si=resultado requiere otra fuente; evidencia=nueva pregunta precisa
- [diagnose](diagnose.md) — rel=next; si=se obtuvo reproducción de fallo; evidencia=señal roja estable
- [implement](implement.md) — rel=next; si=experimento valida un seam práctico; evidencia=alcance mínimo
- [plan](plan.md) — rel=next; si=experimento indica decisiones amplias; evidencia=requisitos priorizados
- [unblock](unblock.md) — rel=recover; si=experimento inviable o ambiguo; evidencia=razón y alternativa
