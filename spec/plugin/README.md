# Plugin Goal Compass v0.1.0 · formato MCode 0.4+

Plugin de prompts sin hooks, scripts de runtime, MCP, telemetría ni escritura automática. Fuente de la Skill: `skills/SKILL.md`; recursos `skills/goal-compass/graph/`. La copia bajo `skills/goal-compass/SKILL.md` se mantiene byte idéntica para compatibilidad con validadores y layouts anteriores. 

## Instalación

1. `mcode --version`; formato previsto ≥0.4.x.
2. `mcode plugin marketplace list`: identificar el directorio **local** del perfil.
3. Copiar **esta carpeta completa** como `<directorio-local>/goal-compass` sin añadir capas de carpetas extra.
4. En MCode `/plugins`, refrescar/habilitar; abrir sesión nueva y `/skills`.
5. Probar el nombre mostrado en roster: `/goal-compass <objetivo>` (o seleccionar el plugin con `@` y describir la tarea).

No crear `/goal` mediante esta Skill: es comando nativo separado. No usar `mcode plugin add goal-compass@local` para copiar rutas; no funciona como importador. Esta instalación es **propuesta** y exige prueba en MCode real.
