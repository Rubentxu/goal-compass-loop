# diagnose · Fallo / regresión

## Cuándo entrar

Existe comportamiento incorrecto observado o reportado, incluso si aún no es reproducible.

## Preguntas

1. ¿Qué señal observable pondría roja la hipótesis?
2. ¿Puedes reproducirla con el comando más barato?
3. ¿El error nace del producto o del harness?

## Acción mínima

Buscar reproducción reducida: primero comando existente, prueba focalizada, log confiable o fixture. No reescribir pruebas para ponerlas verdes. Candidato: `diagnosing-bugs` (modelo).

## Criterio de salida

Resultado de reproducción red/green u obstáculo específico, no teoría por intuición.

## Enlaces

- [implement](implement.md) — rel=next; si=causa y seam conocidos; evidencia=reproducción roja y cambio mínimo
- [probe](probe.md) — rel=next; si=falta aislar causa; evidencia=experimento que discrimina dos hipótesis
- [verify](verify.md) — rel=next; si=ya existe corrección aplicada; evidencia=señal de regresión que puede pasar
- [unblock](unblock.md) — rel=recover; si=reproducción imposible tras intento razonable; evidencia=impedimento específico
- [stop](stop.md) — rel=escalate; si=no hay acceso al sistema o permiso; evidencia=lo que debe aportar el usuario
