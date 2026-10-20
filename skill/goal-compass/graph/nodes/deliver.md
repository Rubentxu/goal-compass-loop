---
id: deliver
role: agent
links:
  - to: finish
    rel: complete
    when: entrega solicitada efectuada
    evidence: identificador/resultado real
  - to: verify
    rel: recover
    when: gate final falla
    evidence: error de gate
  - to: unblock
    rel: recover
    when: sin remoto/acceso/permiso
    evidence: motivo concreto
  - to: stop
    rel: escalate
    when: operación insegura o no autorizada
    evidence: paso requerido por humano
---

# deliver · Entrega controlada

## Cuándo entrar

Objetivo verificado; usuario pidió commit, PR, tag/release, push o entrega, y hay permisos.

## Preguntas

1. ¿Qué operaciones de publicación autorizó exactamente el usuario?
2. ¿Cuál es la evidencia mínima que acompaña esta entrega?
3. ¿Hay archivos efímeros que deban quedar fuera del commit?

## Acción mínima

Revisar diff y cambios inesperados; preparar Conventional Commit. Ejecutar push, tag, release o PR **solo cuando el usuario los autorizó** y el remoto/credenciales funcionan. Candidato `pr` (modelo). No retirar tests permanentes necesarios para funcionalidad.

## Criterio de salida

Commit/release/enlace verificables, o indicar claramente si la operación no se ejecutó.
