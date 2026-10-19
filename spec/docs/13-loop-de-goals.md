# Especificación funcional · Misión continua y Goals encadenados

**Cambio respecto a Goal Compass 0.1:** completar un Goal NO concluye la misión. Cierra la **unidad atómica de valor** y provoca la decisión de un **Goal nuevo**, hasta que el usuario pause/cancele o haya una restricción real.

## Lenguaje ubicuo

- **Mission**: intención de duración indefinida y restricciones de usuario. Su estado es ajeno al Goal de MCode.
- **Goal**: objetivo verificable, acotado, ejecutado por **el Goal nativo** de MCode en una Session. Solo uno activo por Session.
- **Candidate**: posible Goal, nacido de roadmap real, incidencia, regresión, oportunidad descubierta o investigación validada.
- **Receipt**: evidencia observable del Goal ya terminado; nunca una aseveración sin fuente.
- **Link**: acción elegible desde el estado actual; no es un plan rígido de pasos.
- **Supervisor**: proceso externo pequeño, dueño único de ACP y de la creación de nuevos Goals.
- **Park**: misión viva, sin trabajo que pueda ejecutarse por ahora; espera evento o intervención, sin consumo inútil.

## Flujo obligatorio

1. Usuario define `mission` y límites de actuación; se crea primera lista acotada de candidaturas o una búsqueda controlada.
2. Supervisor crea **un** Goal nativo (`mcode/session/goal/create`) en una Session ACP bajo su control.
3. El Runtime ejecuta Goal con su mecanismo de continuación. En el interior, la Skill `goal-compass` decide investigar/diagnosticar/planificar/implementar/verificar/desbloquear. No simula crear Goals.
4. Runtime publica estado de Goal. El supervisor trata `complete` durable como **evento que obliga a reevaluar**, no como fin de misión.
5. Supervisor lee objetivo completado, comprueba los límites, descarta candidatos ya satisfechos, consulta backlog y, si hace falta, obtiene nuevas propuestas mediante **una** exploración acotada y preferiblemente de solo lectura.
6. Elige candidato con evidencia, motivo, criterio de aceptación, coste/riesgo y capacidad de verificación. Persiste intención de transición, crea Goal nuevo y registra recepción.
7. Repite indefinidamente **mientras exista acción autorizada y progreso potencial**. Sin trabajo, pone la misión en `parked` y reevalúa ante nuevo cambio/instrucción; no crea metas de relleno.

## Semántica de estados

`MissionStatus = Running | Parked(reason) | PausedByUser | StoppedByUser | Escalated(reason)`.

`GoalStatus` de MCode: `active | paused | blocked | complete | budget_limited | usage_limited`.

Solo `complete` autoriza la transición normal **a otro Goal**. `paused`, `blocked`, `budget_limited` y `usage_limited` no significan éxito: explorar alternativa ya autorizada *solo* si política y razón lo permiten; por defecto pausar/esperar, sin dar la vuelta a límites del host creando otro Goal para eludirlos.

## Continuidad sin repetición

- No confundir «no terminar tras un Goal» con «iterar sin evidencia». Cada nuevo Goal debe aportar un cambio observable o una incertidumbre falsable.
- Objetivos pequeños y autoverificables; evitar macro-goals inacabables y micro-goals burocráticos.
- Después de dos caminos equivalentes sin nueva información, derivar a `unblock`; no incrementar tokens de forma ciega.
- No crear Goals que reabran trabajo ya verificado; deduplicar por clave estable basada en *intención + alcance + criterio*, no solo literal del texto.
- Si no quedan candidatos, abrir como mucho una investigación *distinta* y respaldada por señales reales; si tampoco produce trabajo útil, Park.
- Los permisos de operaciones peligrosas no se heredan de «autonomía continua»: push, release, despliegue y operaciones destructivas requieren habilitación explícita.

## Configuración de misión

Archivo fuera del repositorio en `~/.local/state/goal-compass/<mission-id>/mission.json` (o ubicación XDG elegida); ejemplo [`examples/mission.json`](examples/mission.json). No editar `docs/`, crear `.pipeline.kts` ni volcar estado en el proyecto analizado.

## Criterios de aceptación

- A1: con dos candidaturas y primer Goal completado, supervisor crea el segundo sin intervención humana.
- A2: ante 2 notificaciones idénticas de `complete`, solo una creación.
- A3: al reiniciar después de crear remotamente pero antes del commit local, reconcilia mediante `get`; no crea un duplicado.
- A4: ante Goal `active` no crea otro. Ante `blocked/paused/budget_limited/usage_limited` no elude el límite.
- A5: cuando el backlog se agota pero existe trabajo verificable descubierto, propone un nuevo Goal pertinente.
- A6: sin candidatos/evidencia, Mission `parked`; reanudable y sin inventarse trabajo.
- A7: si no existe la extensión ACP habilitada, falla *cerrado* y reporta incompatibilidad.
- A8: tras marcar `complete` el modelo no intenta llamar a `create_goal` (no disponible); la creación siempre la hace el supervisor.
