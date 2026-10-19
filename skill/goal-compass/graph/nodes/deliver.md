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

## Enlaces

- [finish](finish.md) — rel=complete; si=entrega solicitada efectuada; evidencia=identificador/resultado real
- [verify](verify.md) — rel=recover; si=gate final falla; evidencia=error de gate
- [unblock](unblock.md) — rel=recover; si=sin remoto/acceso/permiso; evidencia=motivo concreto
- [stop](stop.md) — rel=escalate; si=operación insegura o no autorizada; evidencia=paso requerido por humano
