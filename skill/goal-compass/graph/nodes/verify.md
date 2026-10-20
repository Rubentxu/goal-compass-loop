---
id: verify
role: agent
links:
  - to: diagnose
    rel: recover
    when: falla prueba relevante
    evidence: error reproducible
  - to: implement
    rel: recover
    when: revisión detectó defecto claro
    evidence: cambio acotado solicitado
  - to: deliver
    rel: next
    when: objetivo probado y usuario autoriza entrega
    evidence: prueba y diffs revisados
  - to: finish
    rel: complete
    when: solo se solicitó comprobar y se hizo
    evidence: resultado y límite
  - to: unblock
    rel: recover
    when: no existe manera de verificar con permisos actuales
    evidence: bloqueo de verificación
---

# verify · Verificación precisa

## Cuándo entrar

Existe cambio o afirmación que requiere contraste antes de declararse conseguido.

## Preguntas

1. ¿Qué resultado demostraría exactamente la conducta exigida?
2. ¿Cuál es el menor comando/test capaz de desmentirla?
3. ¿El gate requerido por el repo exige algo más antes de release?

## Acción mínima

Ejecutar test focalizado y typecheck o chequeo pertinente; antes de release realizar el gate exigido por el proyecto, evitando suites innecesarias durante iteración. Candidato `code-review` (modelo) si hay diff.

## Criterio de salida

Evidencia de comando/resultado con alcance y limitaciones; nunca PASS inventado.
