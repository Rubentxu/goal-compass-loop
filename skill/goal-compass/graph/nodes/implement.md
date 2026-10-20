---
id: implement
role: agent
links:
  - to: verify
    rel: next
    when: cambio aplicado
    evidence: comando de prueba preciso
  - to: diagnose
    rel: recover
    when: falla conducta al ejecutarla
    evidence: señal roja nueva
  - to: plan
    rel: recover
    when: alcance creció por dependencia real
    evidence: nueva rebanada
  - to: unblock
    rel: recover
    when: API/permisos/seam no permiten continuar
    evidence: causa demostrada
---

# implement · Implementación pequeña

## Cuándo entrar

Cambio autorizado con comportamiento esperado, frontera de modificación y posibilidad de comprobación.

## Preguntas

1. ¿Qué comportamiento mínimo vamos a cambiar?
2. ¿Cuál es el seam correcto sin duplicar responsabilidades?
3. ¿Qué prueba focalizada mostraría el cambio?

## Acción mínima

Aplicar un vertical slice pequeño, priorizando función pura cuando proceda, ADTs si resuelven ambigüedad, tests quirúrgicos junto a código; no fabricar harness. Candidatos `tdd`/`codebase-design` (modelo); las skills marcadas como manuales requieren que las lance el usuario.

## Criterio de salida

Diff acotado y un resultado de verificación, o un motivo verificable de bloqueo.
