# Roadmap de entrega · Goal Compass Loop

**Orden de prioridad:** comprobar conexión real MCode ACP antes de desarrollar arquitectura extra. Al final de cada hito: código útil, revisión de diff, commit Conventional Commit, tag/release y push **si están autorizados** y existen remoto/credenciales. Nunca afirmar release sin prueba remota.

## M0 · Probe ACP real (v0.2.0-rc1) — BLOQUEANTE

- [ ] Identificar `mcode --version` y negociar capacidades de `mcode acp` con cliente oficial ACP (SDK).
- [ ] Demostrar `session/new|load`, `mcode/session/goal/get`, `.../create`, notificación `.../goal_update` en Session aislada.
- [ ] Registrar estructura real de evento y errores; comprobar `isGoalEnabled`, permisos y que solo hay un cliente por proceso.
- [ ] Determinar arranque/desconexión y convivencia con TUI. Si los métodos están ausentes, parar: no inventar APIs.

**Entregable:** spike de conexión real en `reference/spikes/` o `/tmp`, suprimir scripts de prueba tras evidencia; contrato de adapter adaptado al host; release RC. Investigación de protocolo se puede hacer en paralelo con pulido de prompts, pero no implementar transporte sin M0.

## M1 · Dos Goals encadenados (v0.2.0)

- [ ] Núcleo puro `GoalSnapshot -> Decision` y adaptador ACP real con `read/create`.
- [ ] Un solo writer por Mission/Session; persistir Journal mínimo con fsync+atomic rename fuera de repo.
- [ ] Al `complete`, elegir segundo Goal del backlog con evidencia, `doneWhen` y prerequisitos; **crearlo sin humano**.
- [ ] Recuperar tras muerte a mitad de `create`; reconciliar con `get`; no repetir Goals completados.
- [ ] UAT **efímera**: 2 Goals, 1 notificación duplicada y 1 reinicio abrupto; conservar solo aprendizaje.

**Gate:** `goal1 -> complete -> create(goal2) -> active` verificado con IDs diferentes, sin duplicados. Release v0.2.0.

## M2 · Descubrimiento autoguiado HATEOAS + Matt (v0.3.0)

- [ ] Habilitar `choose-next` y `await-work` con catálogo de affordances elegibles tras cada Goal.
- [ ] Priorizar evidencias existentes: issues/roadmap/errores/resultados antes de solicitar investigación LLM.
- [ ] Si backlog vacío, una inspección acotada produce `Candidate` estructurado; verificarlo deterministamente antes de `create`.
- [ ] Descubrir skills `mattpocock/skills` instaladas y elegir adecuadas por nodo, respetando `disable-model-invocation`.
- [ ] UAT efímera: desde bug -> fix -> review -> nuevo evolutivo. Además, caso sin trabajo -> `parked`.

**Gate:** misión sigue viva con Goal nuevo útil o en `parked`; jamás crea tareas ficticias. Release v0.3.0.

## M3 · Operación autónoma sostenible (v0.4.0)

- [ ] Reaccionar a pausa/cancelación de usuario, restricciones de cuota/budget/rate limit y aprobaciones pendientes.
- [ ] Bloquear escalada de permisos, auto-publicaciones no autorizadas, reintentos sin evidencia y loops de gasto.
- [ ] Recuperación de ACP tras reconexión usando `get` y Journal; registrar mínimo historial de Goals y sus proofs.
- [ ] Comparar coste y progreso observable sobre 3–5 Goals encadenados; reducir prompts y código, no añadir harness.
- [ ] Retirar UAT/E2E/AAT efímeros y publicar release en remoto si autorizado.

**Gate:** segura detención ante bloqueo, reanudación sin duplicados y creación automática tras completion verificada. Release v0.4.0.

## No hacer

- Nunca añadir servicio MCP o servidor HTTP solo por el loop.
- No usar `Stop` para reanudar arbitrariamente la generación.
- No meter estado ni scripts efímeros en el repo de trabajo.
- No crear un orquestador multiagente, CI o matriz de test desproporcionada.
- No usar un Goal nuevo para saltarse un `budget_limited` del Goal anterior.

## Política de pruebas

Retener exclusivamente 4–8 pruebas puras que impidan duplicación, pérdida de transición o paso indebido tras límites. 1–2 E2E ACP reales efímeros por hito de frontera; borrar harness al cierre. Conservar recibo humano (lo que pasó y lo que no). `reference/check_chain_core.py` es orientación mínima inicial, no sustituto de la UAT ACP.
