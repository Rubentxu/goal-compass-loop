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

## Enlaces

- [diagnose](diagnose.md) — rel=recover; si=falla prueba relevante; evidencia=error reproducible
- [implement](implement.md) — rel=recover; si=revisión detectó defecto claro; evidencia=cambio acotado solicitado
- [deliver](deliver.md) — rel=next; si=objetivo probado y usuario autoriza entrega; evidencia=prueba y diffs revisados
- [finish](finish.md) — rel=complete; si=solo se solicitó comprobar y se hizo; evidencia=resultado y límite
- [unblock](unblock.md) — rel=recover; si=no existe manera de verificar con permisos actuales; evidencia=bloqueo de verificación
