# Encargo: construir Goal Compass Loop sin convertirlo en un framework

## Meta verificable

Con MiniMax MCode **real** y un único cliente `mcode acp`, crear Goal A; cuando A esté `complete` durable, **crear automáticamente Goal B nativo en la misma Session**, sin comando del usuario. Luego repetir con descubrimiento HATEOAS de tareas y skills Matt. Mantener una Mission superior viva al cierre de cada Goal. Estado fuera de repos.

## Lectura obligatoria (orden)

1. `README.md` y `docs/13-loop-de-goals.md` (la funcionalidad pedida).
2. `docs/14-protocolo-supervisor.md` (verdades y límites de ACP).
3. `docs/06-roadmap.md` y `docs/15-uat-y-limites.md` (hitos/gates mínimos).
4. `docs/adr/ADR-006.md`, `ADR-007.md` y `docs/05-adaptadores-matt.md`.
5. `plugin/skills/goal-compass/graph/index.md` y solo nodos elegidos por evidencia.

## Instrucciones de implementación

- Empieza por **M0**: handshake ACP real y descubrir métodos. Verifica rutas, status y notificación exacta; si no existen, no fabriques integración ni afirmes éxito.
- Sigue con **M1**: `get` confirmando `complete` -> `Candidate` elegible -> Journal intent -> `create` -> `get` read-back -> Journal commit. Idempotencia bajo repetición y reinicio es requisito, no extra.
- Mantén núcleo puro (`Snapshot -> Decision`) con ADT/funciones puras y efectos solo en interfaces ACP, Journal y Discover. Kotlin/Rust/TS son aceptables según SDK más directo; no reescribas el host.
- Apóyate en skills Matt instaladas tras descubrirlas, sin clonar ni asumir que skill `disable-model-invocation: true` pueda ser invocada automáticamente. Usa procedures model-invoked solo cuando el runtime lo permita.
- No crees 15 tipos de harness. TDD quirúrgico con 4–8 contratos de riesgos reales; 1–2 UAT ACP efímeras y borrar infraestructura de prueba al cierre.
- Mantén un solo proceso `mcode acp` y un escritor por Session. Respeta permisos, cuotas, presupuesto y pausa. Nunca eludas un budget cap mediante Goal B.
- Entrega al fin de cada bloque: evidencia, changelog muy corto, commit Conventional Commit, tag semver, push/release remoto **si autorizado**. Una UAT que no corrió queda NOT RUN.

## Criterios mínimos

1. `Goal A.complete` causa `Goal B.active` con ID distinto, sin intervención del usuario.
2. Notificación repetida y crash no crean B dos veces.
3. `blocked`, `paused`, `budget_limited`, `usage_limited` no disparan Goal nuevo por la puerta trasera.
4. Sin candidatos, Mission `parked` y reanudable sin loops de tokens.
5. Skill Goal Compass selecciona rutas de investigación/testing/implementación mínimas con skills Matt, no duplica lógica nativa.

## Ojo con la trampa

El proyecto anterior era un router de prompts. **No** lo des por concluido por mejorar la Skill: esta evolución necesita un supervisor ACP real. Por otro lado, `mcode acp` NO ofrece por definición control de la Session de la TUI abierta; verifica integración antes de prometerla.
