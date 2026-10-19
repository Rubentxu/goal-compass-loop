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

## Enlaces

- [probe](probe.md) — rel=next; si=falta prueba empírica; evidencia=experimento pequeño definido
- [plan](plan.md) — rel=next; si=conocimiento suficiente y cambio grande; evidencia=restricción principal aclarada
- [implement](implement.md) — rel=next; si=trabajo mínimo ya definido; evidencia=comportamiento deseado
- [finish](finish.md) — rel=complete; si=la investigación era el objetivo y está sustentada; evidencia=fuentes y conclusión
- [unblock](unblock.md) — rel=recover; si=no hay fuentes fiables; evidencia=vacío de evidencia
