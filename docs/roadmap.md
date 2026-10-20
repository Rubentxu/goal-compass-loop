# Roadmap · Goal Compass Loop

Lo que queda por hacer, con la evidencia de que hace falta y con la condición
observable que lo da por terminado. Cada entrada es un candidato de la misión:
la cadena puede encadenarlo sin que nadie lo escriba a mano.

Las fuentes normativas del proyecto son [CICLO.md](CICLO.md) (qué es el
sistema), [EVIDENCIA.md](EVIDENCIA.md) (lo que ya está medido) e
[IDEAS.md](IDEAS.md) (lo que se consideró y no se integró, con su motivo).

Las propuestas de esta lista nacieron de una lectura del código, no de una
tormenta de ideas: cada una señala el fichero y la línea donde está el hueco.

La primera se encontró encendiendo la cadena sobre este mismo repositorio:
el hook se apuntó a la sesión y le cobró a la misión el gasto de un objetivo
que la cadena no había creado.

---

<a id="p0"></a>

## 0 · El objetivo del usuario no se le cobra a la misión

**Prioridad:** máxima · **Estado:** corregido, falta documentar y medir

**El hueco.** El presupuesto de la misión mide el gasto de **la cadena**, pero
se contaba el de cualquier objetivo que apareciera en la sesión. El objetivo
nativo que el usuario ya tiene en marcha es suyo, y su consumo no es de esta
misión.

El efecto no es teórico: al encender la cadena sobre este repositorio, el
objetivo que ya estaba en la sesión se contabilizó entero y la misión quedó
dormida por presupuesto agotado nada más declararla. Con un presupuesto
normal, cualquier sesión que ya tenga un objetivo previo deja la misión
muerta al instante, y el motivo dice «presupuesto agotado» sin decir de
dónde salió el gasto.

**Evidencia.**

- `src/supervisor.ts` — al registrar un objetivo terminado se metía en el
  historial de la misión aunque no tuviera intención que lo creara.
- `src/supervisor.ts` — el objetivo en curso sumaba sus tokens al total
  aunque tampoco lo creara la cadena.

**Condición de cierre.**

- Un objetivo sin intención que lo cree no se registra en la misión ni suma a
  su presupuesto.
- El objetivo que la cadena creó sí se cobra, y el freno sigue mordiendo.
- Hay una prueba que falla sin el arreglo.

**Alcance.** `src/supervisor.ts`, `test/supervisor.test.ts`.

---

<a id="p1"></a>

## 1 · La evidencia y el criterio de cierre llegan al objetivo

**Prioridad:** alta · **Desbloquea:** que el roadmap mande sobre el trabajo

**El hueco.** El backlog de la misión guarda, de cada candidato, su evidencia
(el fichero que lo pide) y su criterio de cierre (cómo se sabrá que está
hecho). Pero esa información **se pierde antes de llegar al agente**: el
objetivo se crea con el texto del objetivo y el presupuesto, y nada más. El
agente recibe «haz esto» sin «esto sale de aquí» ni «esto se demuestra
así».

Con un roadmap, la consecuencia es directa: el agente vuelve a buscar en qué
fichero está el trabajo que le acaban de encargar, en cada turno, y el
criterio de cierre —la parte que decide si el objetivo está demostrado— no
llega nunca a quien tiene que demostrarlo.

**Evidencia.**

- `src/core/types.ts:116` — `TransitionIntent` guarda `candidateId`,
  `candidateKey`, `objective` y `tokenBudget`. La evidencia y el criterio de
  cierre no se guardan.
- `src/supervisor.ts:391` — el objetivo se crea con `candidate.objective` y
  `tokenBudget`. Lo demás se queda en el candidato.
- `src/plugin/auto-continue.ts:118` — la respuesta de continuación lleva
  `outcome.created.objective` y el contexto de la misión, pero no la
  evidencia ni el criterio del candidato que se está encadenando.

**Condición de cierre.**

- La intención persistida guarda la evidencia y el criterio de cierre del
  candidato, y se leen del journal.
- La respuesta de continuación nombra el fichero de evidencia y el criterio
  de cierre del objetivo que se está encadenando.
- Hay una prueba que falla sin el cambio y pasa con él, sobre un candidato
  con evidencia.

**Alcance.** `src/core/types.ts`, `src/supervisor.ts`,
`src/plugin/auto-continue.ts`, `src/adapters/mission.ts`.

---

<a id="p2"></a>

## 2 · El estado de la misión dice quién conduce y por qué no se encadenó

**Prioridad:** alta · **Desbloquea:** la regla de la skill y la confianza del
usuario

**El hueco.** La skill dice al agente que consulte el estado de la misión y
que, si dice quién conduce, no espere al siguiente objetivo. Pero **el estado
no lo dice**: la salida de la herramienta no incluye el camino que conduce la
misión ni el motivo por el que no se encadenó. La regla no se puede aplicar
porque el dato no está.

El efecto es doble: el agente no puede distinguir «no hay trabajo» de «otro
camino conduce», y el usuario no tiene forma de saber por qué su cadena no
arranca.

**Evidencia.**

- `src/plugin/mcp-server.ts:147` — la salida del estado dice la misión, el
  estado, los objetivos encadenados, las propuestas y el trabajo disponible.
  El camino que conduce no aparece.
- `skill/goal-compass/SKILL.md` — remite a ese dato: «Si `mission_status` dice
  quién conduce, tu turno no va a encadenar el siguiente Goal».

**Condición de cierre.**

- La salida del estado incluye el camino que conduce la misión y, cuando no
  se encadena nada, el motivo.
- La prueba del servidor de herramientas comprueba las dos cosas.

**Alcance.** `src/plugin/mcp-server.ts`, `test/mcp-server.test.ts`.

---

<a id="p3"></a>

## 3 · Un diagnóstico que dice si la cadena puede trabajar aquí

**Prioridad:** media-alta · **Desbloquea:** el primer minuto de quien instala

**El hueco.** Declarar una misión es fácil; saber si va a funcionar es otra
cosa. Hoy, si el plugin no está registrado en MCode, la misión se declara
igualmente y no encadena nada, sin decir por qué. El comando que declara
tampoco lo comprueba. Quien acaba de instalar pasa de «no funciona» a
«funciona» sin ningún dato en medio.

**Evidencia.**

- `src/cli.ts:110` — el comando que declara deja el proyecto preparado y
  avisa del identificador, pero no mira si el plugin está registrado.
- No hay ningún comando que dé el diagnóstico: el estado necesita un
  identificador de misión y no sirve para responder «¿esto puede trabajar?».

**Condición de cierre.**

- El comando que declara avisa cuando el plugin no está registrado, con el
  comando exacto para registrarlo.
- Hay un comando de diagnóstico que responde, para un directorio dado: si hay
  plugin registrado, si hay misión declarada, qué camino la conduce, cuánto
  presupuesto queda y cuál fue el último objetivo encadenado.

**Alcance.** `src/cli.ts`, `src/plugin/install.ts`, `src/adapters/mission.ts`.

---

<a id="p4"></a>

## 4 · El proyecto puede partir del árbol sin escribirlo a mano

**Prioridad:** media · **Desbloquea:** la personalización por proyecto

**El hueco.** El árbol propio del proyecto manda sobre el de la skill, y el
comando que lo prepara solo valida: si el proyecto no tiene nodos, se usa el
de la skill. Pero **no hay forma de crear uno**: partir de un árbol propio
exige escribir trece fichas con su cabecera a mano, que es justo el trabajo
que el árbol quería evitar.

**Evidencia.**

- `src/cli.ts` — el comando del árbol prepara el directorio y valida; no
  ofrece ningún punto de partida.
- `src/adapters/workdir.ts` — el directorio del proyecto se considera un
  árbol cuando tiene markdown dentro; nada lo rellena.

**Condición de cierre.**

- Hay una forma de crear el árbol del proyecto a partir del de la skill, y el
  árbol creado valida sin problemas.
- El árbol copiado es editable y el proyecto manda sobre la skill desde el
  siguiente ciclo.

**Alcance.** `src/cli.ts`, `src/adapters/workdir.ts`, `src/adapters/tree.ts`.

---

<a id="p5"></a>

## 5 · El ejemplo de declaración está al día

**Prioridad:** baja · **Alcance:** `examples/mission.json`

**El hueco.** El fichero de ejemplo es lo que la gente copia, y está más
viejo que el producto: no declara el camino que conduce la misión, que
existe desde que una misión tiene un solo conductor, y su evidencia apunta a
secciones que no existen en el documento al que señala.

**Condición de cierre.**

- El ejemplo declara todos los campos que el producto lee hoy.
- Su evidencia señala a ficheros que existen de verdad.
- Al copiarlo y declararlo, la misión se inicializa sin tocarlo.

---

<a id="p6"></a>

## 6 · Las dos decisiones que más cambiaron el producto tienen su ADR

**Prioridad:** media · **Alcance:** `docs/adr/`

**El hueco.** Las fuentes normativas del proyecto están en `docs/adr/`, y las
dos decisiones que más han cambiado el contrato del producto —el árbol como
dato en lugar de prosa, y la declaración de la misión como puerta con
identificador derivado— no tienen la suya. Quedan las de los ciclos anteriores
y el razonamiento nuevo vive en el cuerpo de la documentación.

**Condición de cierre.**

- Hay un ADR para el árbol como dato y otro para la puerta de declarar, con
  su contexto, la decisión, las alternativas descartadas y su motivo.
- Cada ADR dice qué.fixture deja de ser válido, si deja algo.

---

## Resumen

| # | Propuesta | Prioridad | Depende de |
|---|---|---|---|
| 0 | El objetivo del usuario no se le cobra a la misión | máxima | — |
| 1 | La evidencia y el criterio de cierre llegan al objetivo | alta | — |
| 2 | El estado dice quién conduce y por qué no se encadenó | alta | — |
| 3 | Un diagnóstico que dice si la cadena puede trabajar aquí | media-alta | 2 |
| 4 | El proyecto puede partir del árbol sin escribirlo a mano | media | — |
| 5 | El ejemplo de declaración está al día | baja | — |
| 6 | Las dos decisiones que más cambiaron el producto tienen su ADR | media | — |
| 7 | El ciclo activo, a la vista | media-alta | 2 |

---

<a id="p7"></a>

## 7 · El ciclo activo, a la vista

**Prioridad:** media-alta · **Desbloquea:** que el usuario vea la cadena

**El hueco.** La cadena trabaja y no se ve. El estado durable es un JSON en
`~/.local/state/goal-compass/`, el hook escribe sus avisos en la salida de
error y lo único que el agente ve es el texto de la continuación. Para saber
qué está haciendo la misión ahora mismo —qué objetivo va, cuáles están
hechos, cuánto queda, quién conduce— hay que ir a leer un fichero a mano.

**Lo que se puede y lo que no.** Un plugin no dibuja panels: la interfaz del
host es del host, y lo que un plugin aporta son herramientas, recursos,
prompts, skills y hooks. Pero el host sí tiene superficies donde el progreso
se ve:

- la **lista de tareas** del modelo, que se ve en pantalla;
- los **prompts** del servidor de herramientas, invocables con `/`;
- los **recursos** del servidor de herramientas, que se pueden abrir.

La vía real es una: que la cadena sabe decir, en texto, cómo va el ciclo; y
que ese texto llegue a una de esas superficies.

**Evidencia.**

- `src/plugin/mcp-server.ts` — el estado devuelve texto plano con el estado y
  el trabajo disponible, pero sin el objetivo en curso ni la cadena de
  objetivos hechos y pendientes.
- `src/plugin/auto-continue.ts` — la respuesta de continuación dice qué
  objetivo toca, pero no qué se ha hecho ni qué queda por delante.
- El manifiesto del plugin admite herramientas, recursos, prompts, skills y
  hooks, y ninguna superficie de panel: no hay un punto de extensión para
  dibujarlo.

**Condición de cierre.**

- Hay una vista del ciclo activo en texto: objetivo de la misión, objetivo en
  curso con su evidencia, objetivos hechos y pendientes con su estado,
  presupuesto consumido y total, y qué camino conduce la misión.
- Esa vista se puede pedir desde la conversación y devolverse como recurso.
- El agente la refleja en su lista de tareas, de modo que el progreso queda
  a la vista sin que el usuario tenga que pedirlo.

**Alcance.** `src/plugin/mcp-server.ts`, `src/plugin/auto-continue.ts`,
`skill/goal-compass/SKILL.md`.
