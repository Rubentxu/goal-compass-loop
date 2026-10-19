# Instalar y descubrir skills de Matt en MCode sin ensuciar repositorios

## Regla de diseño

Goal Compass no depende de Matt para arrancar. Un adaptador se activa solo cuando el catálogo de MCode demuestra que la skill está presente y puede invocarse de la manera requerida.

## Instalación preferente

1. Consultar los mecanismos soportados por el instalador actual `npx skills@latest add mattpocock/skills` y comprobar la lista de agentes que ofrece (no dar por hecho que MCode figura entre ellos).
2. Si el instalador soporta el destino, seleccionar exclusivamente las Skills necesarias: `diagnosing-bugs`, `research`, `prototype`, `tdd`, `code-review`, `codebase-design`, `domain-modeling` y `writing-for-agents`. Instalar las demás solo al necesitarlas.
3. Alternativa verificable desde el código fuente de MCode: usar las rutas de skills del runtime (`<DATA_DIR>/skills/` según su skill-creator) y colocar allí **carpetas completas** de las skills elegidas, con sus subdirectorios `references/` y recursos; no copiar solo `SKILL.md` si contiene referencias relativas.
4. Si solo se quiere un proyecto concreto, usar `.agents/skills/<skill>` o `.minimax/skills/<skill>` del workspace; MCode admite symlinks de directorios, que permiten enlazar un catálogo instalado fuera del repo. **No meter copias de terceros en Git por defecto**.
5. Abrir sesión nueva; dentro de MCode usar `/skills`, verificar nombre exacto, origen y activación. Si hay duplicados, desactivar uno para evitar conflicto de nombres.

## Alcance de `setup-matt-pocock-skills`

Según upstream, esta skill configura issue tracker, etiquetas y destino de documentos. No ejecutar automáticamente en todos los repos: requiere preferencias del usuario y puede introducir archivos que no se desean. Para flujos `to-spec`/`to-tickets`/`wayfinder` optativos que dependen de ella, proponer que el usuario ejecute `/setup-matt-pocock-skills` una vez y seleccione una configuración acorde con su repositorio.

## Integridad de las referencias

`research` de Matt puede pedir informe Markdown en el repositorio y agentes en segundo plano. Goal Compass, en cambio, no lo hace por defecto. Si se invoca realmente la skill Matt, se aplica **su propio contrato**, sujeto al consentimiento, posibilidades reales del host y reglas de proyecto. No fingir que adaptadores como subagentes/background existen en un runtime que no los provee.

## Matriz por disponibilidad

| Caso | Acción |
|---|---|
| Instalada, modelo puede invocarla y host expone Skill tool | Leer contrato e invocar de forma real |
| Instalada, marcada `disable-model-invocation:true` | Sugerir comando exacto al usuario, o seguir con prompt local |
| Instalada, pero no hay herramienta de invocación | Leer instrucciones como referencia solo cuando proceda y ejecutar paso local (sin adjudicar llamada) |
| No instalada | No instalar por sorpresa; seguir con prompt del nodo |
| Contrato externo pide escribir archivos no solicitados | Pedir consentimiento o elegir ruta local si es viable |

## Fuentes

- https://github.com/mattpocock/skills
- https://github.com/mattpocock/skills/blob/main/skills/engineering/ask-matt/SKILL.md
- https://github.com/MiniMax-AI/minimax-code/blob/main/docs/tui-capabilities.md
- https://github.com/MiniMax-AI/minimax-code/blob/main/packages/local-runtime/assets/skills/skill-creator/SKILL.md
