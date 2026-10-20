---
id: diagnose
role: agent
links:
  - to: implement
    rel: next
    when: causa y seam conocidos
    evidence: reproducción roja y cambio mínimo
  - to: probe
    rel: next
    when: falta aislar causa
    evidence: experimento que discrimina dos hipótesis
  - to: verify
    rel: next
    when: ya existe corrección aplicada
    evidence: señal de regresión que puede pasar
  - to: unblock
    rel: recover
    when: reproducción imposible tras intento razonable
    evidence: impedimento específico
  - to: stop
    rel: escalate
    when: no hay acceso al sistema o permiso
    evidence: lo que debe aportar el usuario
---

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
