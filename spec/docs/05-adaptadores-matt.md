# Adaptación al catálogo mattpocock/skills

Fuente canónica: https://github.com/mattpocock/skills/blob/main/README.md y router https://github.com/mattpocock/skills/blob/main/skills/engineering/ask-matt/SKILL.md . No copiar skills de terceros; leer instalación local en tiempo de ejecución. Este listado es una tabla de *candidatos*, no garantía de disponibilidad ni autorización de invocación.

| Nodo Compass | Skill Matt candidata | Invocación según upstream | Propósito / comportamiento alternativo |
|---|---|---|---|
| hub | `ask-matt` | usuario | Guía de flujos; si no disponible, el hub local elige nodo |
| investigate | `research` | modelo | Fuentes primarias; fallback lectura breve, sin archivo repo por defecto |
| diagnose | `diagnosing-bugs` | modelo | Bucle rojo→hipótesis→fix; fallback prueba de reproducción mínima |
| probe | `prototype` | modelo | Spike desechable, fuera de repo si conviene |
| plan | `wayfinder` | usuario | Solo trabajo enorme y neblinoso, no feature pequeña |
| plan | `to-spec`, `to-tickets` | usuario | Plan multi-sesión; proponer ejecución manual si corresponde |
| implement | `implement`, `implement-spec` | usuario | Implementación completa; fallback slice local |
| implement | `tdd`, `codebase-design` | modelo | Validar seam/producto; sin test-harness nuevo |
| verify | `code-review` | modelo | Revisar diff y especificación; fallback inspección acotada |
| deliver | `pr` | modelo | Formato de PR y evidencia; no crear PR sin autorización |
| unblock | `domain-modeling` | modelo | Resolver semántica/ontología |
| unblock | `grilling` | modelo | Preguntas con usuario cuando faltan decisiones genuinas |
| unblock | `wizard` | modelo | Pasos humanos obligatorios, sin capturar secretos en prompt |
| finish | `retro` | usuario | Solo si hay aprendizaje fuerte, no cada microtarea |
| transición | `handoff` | usuario | Transferencia explícita a agente/sesión/contexto distinto |
| transversal | `writing-for-agents` | modelo | Afinar punteros y descripción del nodo, no cargar instrucciones completas |

## Contrato del adaptador (normativo)

1. **Discover**: consultar `/skills` o la lista efectiva de skills en contexto; encontrar nombre exacto y archivo real.
2. **Read**: leer el `SKILL.md` de la capability seleccionada antes de decir qué hará. Respeta instrucciones y scope de esa skill.
3. **Authorize**: si está marcada como `disable-model-invocation: true`, **no inventar activación automática**; recomendar el comando humano o continuar con el paso local de Compass.
4. **Delegate**: si es model-invoked y MCode dispone de un mecanismo real para usarla, invocarla; registrar evidencia del uso. Si no, fallback local.
5. **Return**: traer observaciones/evidencias, no el contenido entero del subflujo, y elegir siguiente enlace.

## Conflictos y compatibilidad

- `ask-matt` cubre *qué flujo hay*, Compass cubre *qué decisión sigue tras el resultado, incluso cuando el flujo se atasca*.
- No forzar siempre `to-spec` → `to-tickets` → `implement`; una reparación pequeña puede saltar a `implement`.
- Los workflows de Matt pueden asumir archivos de tracking; el router **no** escribe documentos permanentes salvo instrucción del usuario o requisito del propio flujo aceptado.
- Algunas skills podrían instalarse en `.agents/skills`, `.claude/skills`, perfiles, o como plugin; no hardcodear rutas de terceros.
- Si se modifica el catálogo upstream, revisar la disponibilidad, frontmatter y división usuario/modelo antes de ajustar el mapa.

## Addendum v0.2: continuidad entre Goals

Tras finalizar un Goal, `choose-next` selecciona entre backlog verificado y oportunidad observada. Usa `research`/`diagnosing-bugs`/`code-review`/`tdd` en la ejecución del nuevo Goal **cuando realmente estén disponibles al modelo**. `ask-matt` es un router user-invoked según su frontmatter; su lista de flujos puede informar la navegación, pero el supervisor no debe simular invocarlo como agente. `to-spec`, `to-tickets`, `implement-spec` e `implement` tienen semánticas y prerequisitos propios que deben verificarse contra las Skills instaladas.
