# Goal Compass Loop · encadenar Goals en MCode

**Revisión 0.2.0 · 2026-10-19 · Proyecto especificado, NO servicio ACP ejecutable**.

Un agente puede cerrar un `/goal` real y, **sin pedir al humano otro comando**, un supervisor externo puede crear el siguiente Goal real, siempre que haya una Mission autorizada y una tarea valiosa por hacer. El supervisor ejecuta la decisión; la Skill solo suministra el mapa de prompts y capacidades. El Goal de MiniMax **no** crea otro Goal por sí solo.

## Vista de una sola pantalla

```text
MISSION (larga vida, independiente del Goal)
   |
   v
[Supervisor ACP: get / create] --> [Goal nativo #1]
        ^                              |
        |                              +-- Worker usa Goal Compass + skills Matt
        |                              |
        |                         complete (durable)
        |                              |
        +-- [Decision / Candidate] <---+
              |            |
              |            +--> sin candidato -> PARK (Mission viva)
              v
          [Goal nativo #2] -> ... -> [Goal nativo #N]
```

## La diferencia más importante

MCode expone al modelo `get_goal` y `update_goal`, **no `create_goal`**. Una Skill no puede provocar por sí sola Goal→Goal. El código sí expone una extensión ACP cliente con `mcode/session/goal/create` y `.../goal/get`; por ello la solución que merece la pena implementar es **Skill + supervisor externo pequeño**. Instalar únicamente la Skill NO encadena Goals.

**Restricción de sesión:** `mcode acp` permite un solo cliente por proceso. Este diseño controla una Session propia de `mcode acp`, **no se conecta mágicamente a una TUI interactiva ya abierta**. No lanzar hosts simultáneos que compartan SQLite sin validación de convivencia. Ver [`docs/14-protocolo-supervisor.md`](docs/14-protocolo-supervisor.md).

## Contenido

- `docs/13-loop-de-goals.md`: misión, nuevo Goal automático, ontología y políticas.
- `docs/14-protocolo-supervisor.md`: rutas ACP exactas, límites, autoridad, journal e idempotencia.
- `docs/15-uat-y-limites.md`: gates y UAT reales imprescindibles.
- `docs/06-roadmap.md`: M0–M3 orientado a entregar Goal→Goal rápido.
- `docs/adr/ADR-006.md` + `ADR-007.md`: por qué no basta un prompt ni un hook.
- `plugin/`: Skill MCode 0.4+ y grafo HATEOAS con 12 nodos, incluyendo `choose-next`/`await-work`.
- `reference/`: núcleo de decisión **puro de ejemplo**, 8 aserciones stdlib; no es un cliente ACP.
- `docs/examples/mission.json`: misión de ejemplo (no copiar sin sustituir referencias ficticias).
- `HANDOFF-AGENT.md`: tarea entregable a un único agente.
- `docs/00..12`: investigación y documentos originales conservados como contexto; los nuevos `13..15` y el nuevo roadmap prevalecen si difieren.

## Comprobación de material (sin MCode)

```bash
python3 tools/check_graph.py
python3 reference/check_chain_core.py
```

Ambos comprueban solamente estructura y lógica ilustrativa, **NO** el runtime MCode. Para una versión funcional de encadenamiento, empieza por M0 y demuestra ACP real con `mcode acp` instalado y autenticado.

## Instrucción de usuario orientativa

```text
Mission: mejora este repositorio continuamente. Cada Goal debe entregar un
incremento de valor demostrado y terminar de verdad. Tras cada complete,
descubre la siguiente tarea autorizada desde bugs, backlog y evidencias;
crea otro Goal nativo automáticamente. Investiga, desbloquea y cambia
estrategia cuando proceda. No añadas harness pesado ni inventes tareas. Si
no hay trabajo útil o hay límites/permiso, deja la misión viva en espera.
```

Esta instrucción guía el **sistema completo** después de instalar el supervisor; introducirla solamente como texto en MCode no instala el automatismo. No copiar keys/tokens a prompt.

## Referencias upstream

- https://github.com/MiniMax-AI/minimax-code/blob/main/packages/local-runtime/src/thread-goal/wiring.ts
- https://github.com/MiniMax-AI/minimax-code/blob/main/packages/agent-modules/goal/src/types.ts
- https://github.com/MiniMax-AI/minimax-code/blob/main/packages/tui/src/acp/extensions.ts
- https://github.com/MiniMax-AI/minimax-code/blob/main/packages/tui/src/acp/agent.ts
- https://github.com/MiniMax-AI/MiniMax-Code-Plugins/blob/main/docs/plugin-compatibility.md
- https://github.com/mattpocock/skills/blob/main/skills/engineering/ask-matt/SKILL.md
