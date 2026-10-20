---
id: stop
role: agent
links:
  - to: await-work
    rel: await
    when: misión sigue autorizada pero carece de señales útiles
    evidence: motivo de espera
  - to: unblock
    rel: recover
    when: aparece permiso o evidencia nuevos
    evidence: cambio que desbloquea
  - to: finish
    rel: complete
    when: se demuestra que el objetivo estaba cumplido
    evidence: prueba válida
---

# stop · Cierre honesto

## Cuándo entrar

El Goal actual está bloqueado o no hay acción segura. No equivale automáticamente a cancelar la Mission.

## Preguntas

1. ¿Qué impide avanzar y quién puede resolverlo?
2. ¿Qué dato único nos permitiría reanudar?

## Acción mínima

Informar progreso parcial y bloqueo exacto, ofrecer siguiente acción humana sin pedir secretos en claro. No repetir trabajo, usar herramientas destructivas ni afirmar éxito.

## Criterio de salida

Bloqueo nombrado, trabajo guardado si estaba autorizado, salida segura.
