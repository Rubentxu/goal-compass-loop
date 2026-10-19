# implement · Implementación pequeña

## Cuándo entrar

Cambio autorizado con comportamiento esperado, frontera de modificación y posibilidad de comprobación.

## Preguntas

1. ¿Qué comportamiento mínimo vamos a cambiar?
2. ¿Cuál es el seam correcto sin duplicar responsabilidades?
3. ¿Qué prueba focalizada mostraría el cambio?

## Acción mínima

Aplicar un vertical slice pequeño, priorizando función pura cuando proceda, ADTs si resuelven ambigüedad, tests quirúrgicos junto a código; no fabricar harness. Candidatos `tdd`/`codebase-design` (modelo); `/implement` de Matt requiere usuario cuando se marque manual.

## Criterio de salida

Diff acotado y un resultado de verificación, o un motivo verificable de bloqueo.

## Enlaces

- [verify](verify.md) — rel=next; si=cambio aplicado; evidencia=comando de prueba preciso
- [diagnose](diagnose.md) — rel=recover; si=falla conducta al ejecutarla; evidencia=señal roja nueva
- [plan](plan.md) — rel=recover; si=alcance creció por dependencia real; evidencia=nueva rebanada
- [unblock](unblock.md) — rel=recover; si=API/permisos/seam no permiten continuar; evidencia=causa demostrada
