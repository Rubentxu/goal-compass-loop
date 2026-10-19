# Contratos operativos de navegación

## Recurso `Node` (Markdown)

Cada `graph/nodes/<id>.md` contiene exactamente los encabezados:

- `# <id> · <etiqueta>` — identidad estable (nombre fichero `id`).
- `## Cuándo entrar` — señales verificables, no un patrón de keywords obligatorio.
- `## Preguntas` — 1–3 preguntas socráticas, pequeñas.
- `## Acción mínima` — 1 paso con presupuesto/alcance y modo de recopilar evidencia.
- `## Criterio de salida` — predicado de evidencia; `inspección != PASS`.
- `## Enlaces` — enlaces relativos Markdown con `rel=<next|recover|complete|escalate|inspect>`, `si=<condición>` y `evidencia=<salida esperada>`.

Ejemplo de enlace:

`- [diagnose](diagnose.md) — rel=next; si=existe fallo observable; evidencia=comando rojo reproducible`

**Nota**: cada nodo se evalúa contra situación actual y permisos reales. Los enlaces representan opciones, **no** instrucciones para recorrerlos todos. Si ninguno procede: pasar a `unblock` o `stop` en vez de inventar una salida.

## Protocolo de exploración

1. Leer `graph/index.md` una vez, resolver el primer nodo por señales actuales.
2. Leer solo el nodo destino. Inspeccionar su skill externa candidata cuando esté presente; `SKILL.md` primero.
3. Ejecutar una sola acción discriminante de ese nodo (sin expandir scope).
4. Contrastar evidencia observada vs salida esperada.
5. Seleccionar exactamente **un** enlace elegible y abrir su recurso. Si el enlace conduce a una skill externa marcada manual, pedir la invocación cuando sea esencial o usar el fallback local, sin simular que la invocó.
6. Si se detecta nueva información, reevaluar ruta; no repetir un camino idéntico sin hipótesis cambiada.

## `DecisionReceipt` (respuesta humana: texto, NO estado de máquina)

```text
Objetivo: <qué cuenta como logrado>
Nodo: <id> · motivo: <señal>
Evidencia: <hecho verificable o «todavía ninguna»>
Acción mínima: <qué hice o qué haré ahora>
Salida: <confirmado|refutado|pendiente|bloqueado>
Siguiente: <enlace concreto> · motivo: <cambio de conocimiento>
```

Emitir ficha breve al iniciar un nuevo nodo o cuando se requiera handoff; no gastar 6 líneas en cada comentario trivial. No declarar `confirmado` solo porque un script devolvió exit 0: distinguir qué propiedad verificó.

## Algoritmo lógico (normativo en intención, no código)

```text
observe(context)
if goal proven and no pending authorized work -> finish
else if repeated same probe twice with no information gain -> unblock
else choose eligible link maximizing information_gain / (risk + cost)
run bounded probe, record factual evidence
if unable due to missing permission/external dependency -> escalate or stop
follow one eligible link; never fabricate signals
```

La heurística valor/coste es cualitativa, no scoring ficticio. No hay bucles cronológicos automáticos, token counters propios ni inferencias de intención basadas en regex.

## Invariantes

- I01: enlace relativo interno resuelve archivo existente (valida script).
- I02: todos los nodos tienen salida hacia `finish`, `unblock` o `stop` por un camino alcanzable.
- I03: toda transición registra un cambio informativo o una razón de escalado.
- I04: `finish` nunca se elige si el objetivo carece de prueba; si el objetivo no se puede probar se informa incertidumbre y bloqueo.
- I05: `stop` no hace push, despliegue ni limpieza destructiva por sí mismo.
- I06: una skill `user-invoked` no se presenta como ejecutada por el modelo.
- I07: tras dos pruebas equivalentes sin información nueva, no se invoca la tercera igual.
- I08: ruta legítima puede ser `investigate -> finish` sin implementar nada.

## Estados lógicos (ADTs conceptuales, no añadir TS)

`Evidence = Observed(source,claim) | Hypothesized(question) | Missing(kind)`

`Progress = Advanced(delta) | Inconclusive(reason) | Blocked(blocker) | Proven(receipt)`

`Action = Inspect(node) | Probe(step) | SuggestSkill(name) | AskOne(question) | End(receipt)`

No persistas esos objetos mientras no haya consumidor verificable. Ontología para evitar ambigüedades, no contrato JSON innecesario.

---

## Addendum v0.2 — Mission vs Goal

`finish` cierra únicamente el **Goal actual**. El supervisor observa su estado `complete` y recorre `choose-next` para crear otro; la Mission no se cierra por ese evento. `await-work` aparca una Mission sin trabajo útil. Estos dos enlaces nuevos son `rel=discover` y `rel=await`.

**Nota:** no se puede implementar encadenamiento nativo con prompts puros. Ver [13-loop-de-goals](13-loop-de-goals.md) y [14-protocolo-supervisor](14-protocolo-supervisor.md). El algoritmo anterior de «fin» era para el Goal individual, no para la Mission.
