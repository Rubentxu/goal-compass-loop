# Evidencia primaria y supuestos de compatibilidad

Consultado: **2026-10-19**. La fuente estable debe revisarse al implementar; los enlaces a `main` cambian. Este paquete es una propuesta fundamentada, no una certificación de ejecución end-to-end.

## Hechos verificados en documentación/código

1. MCode ofrece plugins locales y `/plugins`; se localiza directorio mediante `mcode plugin marketplace list` y se copia el paquete dentro como hijo directo, no se instala por URL mediante `mcode plugin add @local`: https://github.com/MiniMax-AI/minimax-code/blob/main/docs/examples.md
2. Comandos de Skill registrados en el runtime: `/skills`, resolución de colisiones a favor de comandos builtin, detección en espacio de trabajo y en plugins: https://github.com/MiniMax-AI/minimax-code/blob/main/docs/tui-capabilities.md
3. El formato 0.4+ usa `.claude-plugin/plugin.json` y `skills/SKILL.md`; ejemplo funcional de estructura, aunque el hook del ejemplo no se necesita aquí: https://github.com/MiniMax-AI/MiniMax-Code-Plugins/blob/main/examples/hello-mcode-hooks-v04/README.md
4. `goal` incorporado ofrece create/view/edit/clear/pause/resume/budget: https://github.com/MiniMax-AI/minimax-code/blob/main/packages/tui/src/application/thread-goal-command.ts y `goal-flow.ts` adyacente (fuente inspeccionada). No hay prueba de API pública skill→createGoal.
5. Skills de Matt: catálogo con invocables por usuario frente a modelo y rutas `ask-matt`: https://github.com/mattpocock/skills ; https://github.com/mattpocock/skills/blob/main/skills/engineering/ask-matt/SKILL.md
6. Filosofía de documentos/punteros para agentes: https://github.com/mattpocock/skills/blob/main/skills/productivity/writing-for-agents/SKILL.md
7. Decisiones de cambio de contexto: https://github.com/mattpocock/skills/blob/main/skills/engineering/ask-matt/PHASE-BOUNDARIES.md
8. Reglas de diagnóstico real: https://github.com/mattpocock/skills/blob/main/skills/engineering/diagnosing-bugs/SKILL.md
9. Observador hooks es posible en 0.4+, pero `Stop` no es un contrato de auto-reanudar: https://github.com/MiniMax-AI/MiniMax-Code-Plugins/blob/main/proposals/hooks-v0.4-spec.md

## Lo que NO está verificado

- Que la instalación de este starter se active correctamente en la versión/entorno del usuario.
- Que MCode pueda delegar directamente a una Skill de Matt marcada `disable-model-invocation: true`.
- Que una Skill pueda manipular `/goal` sin intervención del usuario; requiere una API explícita que no se ha demostrado.
- La disponibilidad de todas las skills Matt en MCode sin adaptación. El instalador `npx skills@latest add mattpocock/skills` tiene soporte por agente que debe validarse; no se impone una ruta ficticia.
- Que el árbol **genere** links según el estado automáticamente: v0.1 usa enlaces estáticos y evaluación declarativa por el modelo.

## Reglas de actualización upstream

- Resolver nombre exacto en `/skills` antes de ofrecer invocación.
- Leer `SKILL.md` local original del adaptador antes de afirmar su comportamiento.
- Si cambia su contrato o es `user-invoked`, degradar a sugerencia al usuario o utilizar prompt local acotado, no declarar una llamada que no ocurrió.
- No descargar contenidos externos ni instalar dependencias automáticamente.
