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

<a id="p8"></a>

## 8 · El presupuesto guía, no frena

**Prioridad:** máxima · **Estado:** hecha y medida

**El hueco.** Un objetivo que se quedaba sin presupuesto devolvía «espera» y
la espera no la resolvía nadie: el trabajo a medias se perdía y, a los 45
minutos, la misión se dormía. El presupuesto de la misión hacía lo mismo: al
superarlo, la cadena se detenía.

**Lo que se hizo.** Agotar el presupuesto es quedarse sin sitio, no
equivocarse: el mismo trabajo vuelve a la cola con el doble de margen
(120k → 240k → 480k), hasta tres intentos. El total de la misión se mide y se
enseña, pero no detiene la cadena.

**Condición de cierre.** Un objetivo agotado vuelve a la cola con más margen,
el intento queda anotado con su coste, y un objetivo que no es de la cadena no
se toca. Verificado contra el host real.

<a id="p9"></a>

## 9 · El hook da continuidad y llega a tiempo

**Prioridad:** máxima · **Estado:** hecha y medida

**El hueco.** Un agente terminaba su turno y la cadena no encadenaba nada. El
hook se ejecutaba y fallaba: se daba 9 segundos de margen para un trabajo que
necesita unos 10, y al rendirse dejaba el host ACP en pie, así que el proceso
no terminaba nunca. El host esperaba a su propio límite y tiraba la
continuación preparada. Cada turno perdía más de dos minutos.

**Lo que se hizo.** El margen queda por encima del trabajo real y por debajo
del límite del host; ninguna petición espera sin tope; el host ACP se cierra
siempre; y el proceso del hook termina siempre después de escribir su salida.

**Condición de cierre.** El hook, ejecutado como proceso, termina en menos de
veinte segundos tanto si el host falla como si no contesta, y la continuación
llega al agente.

---

<a id="p10"></a>

## 10 · La continuidad no depende de que la sesión sea pequeña

**Prioridad:** máxima · **Estado:** hecha y medida

**El hueco.** El host solo deja crear un objetivo sobre una sesión que esté
cargada en el proceso que habla con él, y cargar la sesión es leerle todo el
historial: 22 MB y 6,2 segundos en la sesión de este repositorio. El hook
pagaba esa carga en cada turno, con un límite de 10 segundos del host, así que
la cadena se acercaba a romperse justo cuando la sesión se llenaba, que es
cuando más trabajo había. El coste crecía con el trabajo que el propio sistema
producía.

**Lo que se hizo.** Un proceso vivo: nace con la sesión, cuando su historial
todavía es pequeño, se queda con la sesión cargada y atiende por un socket
local las peticiones de crear objetivo. El hook le pregunta al proceso vivo y,
si no está, abre su propio host como antes. Crear el objetivo pasa de 6,2 s a
57 ms, y ya no crece con la sesión.

**Condición de cierre.** El hook crea el siguiente objetivo por el proceso vivo
sin abrir un host nuevo, el proceso vivo muere con la sesión que lo lanzó, y
el camino de reserva sigue funcionando. Verificado contra el host real.

---

<a id="p11"></a>

## 11 · La declaración se comprueba al declararla

**Prioridad:** máxima · **Estado:** hecha y medida · **Desbloquea:** que la cadena
no se quede sin trabajo por un campo mal escrito

**El hueco.** El cargador de candidatos lee unos campos y solo esos. Una
declaración escrita con el vocabulario equivocado se lee entera, pasa la
validación y **no vale para nada**: sus candidatos quedan descartados y la
cadena no tiene nada que encadenar. El caso real: el campo de la evidencia se
llamaba `evidence` (uno) cuando el que se lee es `evidenceRefs` (una lista).
El valor era una ruta que existía, el autor creía que la había dejado, y la
declaración **decía** que llevaba la evidencia.

Declarar no lo detectaba: releía el fichero y daba por buena una declaración
que no servía.

**Evidencia.**

- `src/adapters/mission.ts` — `parseCandidate` lee `evidenceRefs` y nada más:
  un campo con otro nombre se pierde sin decir nada.
- `src/core/decide.ts:45` — `candidateDefect` descarta el candidato sin
  evidencia, y esa es la regla que decide qué se encadena.
- `src/cli.ts` — `declare` releía la configuración y no contaba los candidatos
  que el selector iba a descartar.

**Condición de cierre.**

- Al declarar, se dice cuántos candidatos quedan usables y cuántos se
  descartan, con el motivo de cada uno.
- Un campo que no se lee pero que se parece a uno que sí, dice cuál era el
  campo bueno.
- Hay una prueba que falla sin el cambio y pasa con él.

**Alcance.** `src/adapters/declaration-audit.ts`, `src/cli.ts`,
`test/declaration-audit.test.ts`.

---

<a id="p12"></a>

## 12 · Un diagnóstico de la flota, que no toca nada

**Prioridad:** alta · **Estado:** hecha y medida · **Depende de:** 11

**El hueco.** El plugin conoce su misión y dice cómo va. De las demás no dice
nada: no hay forma de saber si una misión declarada en otro proyecto puede
encadenar o si sus candidatos se quedan todos en la cuneta. La respuesta
existe, pero había que construirla a mano: leer el cargador, cargar cada
declaración, contar los descartados y comprobar que cada ruta de evidencia
apuntara a algo.

Un diagnóstico que además **escriba** en el proyecto ajeno no serviría: para
mirar el estado de las misiones de los demás hace falta poder mirar sin
tocar.

**Evidencia.**

- `src/plugin/mission-locator.ts` — la misión se localiza a partir del
  directorio de trabajo: no hay forma de enumerarlas.
- `src/cli.ts` — todos los comandos trabajan con un workspace o una misión.
- `src/adapters/journal.ts` — el estado durable ya sabe, por misión, de qué
  proyecto es: la flota se puede enumerar.

**Condición de cierre.**

- Hay un comando que audita todas las misiones declaradas y dice, de cada una,
  cuántos candidatos son usables, cuáles se descartan y por qué, y qué
  referencias no apuntan a nada.
- El diagnóstico **solo lee**: no escribe en ningún proyecto, ni en el suyo.
- Hay una prueba que falla sin el cambio y pasa con él.

**Alcance.** `src/adapters/declaration-audit.ts`, `src/cli.ts`,
`test/declaration-audit.test.ts`.

---

<a id="p13"></a>

## 13 · La referencia a la evidencia se comprueba

**Prioridad:** media-alta · **Estado:** hecha y medida · **Depende de:** 11

**El hueco.** La evidencia es texto: una lista de cadenas que nadie comprueba.
Una referencia puede apuntar a un fichero que se movió, y entonces el agente
recibe un puntero a la nada sin que nada se entere: la evidencia es lo que
justifica el trabajo, y una evidencia que no existe no justifica nada.

**Evidencia.**

- `src/adapters/mission.ts` — `evidenceRefs` es una lista de cadenas sin
  ninguna comprobación.
- `src/core/types.ts` — la evidencia viaja como texto hasta el objetivo.

**Condición de cierre.**

- La auditoría dice qué referencias no apuntan a ningún fichero.
- Una referencia con ancla se comprueba contra el ancla del fichero de
  destino: un id explícito, el número de una sección o su título.
- El formato de la referencia está escrito en un sitio, no repartido.

**Alcance.** `src/adapters/declaration-audit.ts`,
`test/declaration-audit.test.ts`.

---

<a id="p14"></a>

## 14 · La prioridad dice lo que quiere decir

**Prioridad:** media · **Estado:** hecha y medida · **Depende de:** 11

**El hueco.** El selector ordena de mayor a menor: más alto, antes. Eso no lo
decía nadie, y una cola escrita al revés —«1 es lo más urgente»— hace que la
cadena empiece por el último candidato. En una declaración real, la auditoría
del proyecto nombraba un candidato como el siguiente y la cadena habría
empezado por otro, sin decir nada.

**Evidencia.**

- `src/core/decide.ts:300` — el selector ordena por prioridad descendente.
- Las declaraciones en el mundo usan los dos sentidos, y nada lo dice.

**Condición de cierre.**

- La auditoría avisa cuando el primer candidato del fichero tiene la
  prioridad más baja: la cadena empezaría por el final.
- El sentido de la prioridad está escrito donde se valida la declaración.

**Alcance.** `src/adapters/declaration-audit.ts`,
`test/declaration-audit.test.ts`.

---

<a id="p0"></a>

## 0 · El objetivo del usuario no se le cobra a la misión

**Prioridad:** máxima · **Estado:** hecha y medida

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

**Prioridad:** alta · **Estado:** hecha · **Desbloquea:** que el roadmap mande sobre el trabajo

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
| 8 | El presupuesto guía, no frena | máxima | — |
| 9 | El hook da continuidad y llega a tiempo | máxima | — |
| 10 | La continuidad no depende de que la sesión sea pequeña | máxima | 9 |
| 11 | La declaración se comprueba al declararla | máxima | — |
| 12 | Un diagnóstico de la flota, que no toca nada | alta | 11 |
| 13 | La referencia a la evidencia se comprueba | media-alta | 11 |
| 14 | La prioridad dice lo que quiere decir | media | 11 |

---

<a id="p7"></a>

## 7 · El ciclo activo, a la vista

**Prioridad:** media-alta · **Estado:** hecha y medida · **Desbloquea:** que el usuario vea la cadena

**El hueco.** La cadena trabaja y no se ve. El estado durable es un JSON en
`~/.local/state/goal-compass/`, el hook escribe sus avisos en la salida de
error y lo único que el agente ve es el texto de la continuación. Para saber
qué está haciendo la misión ahora mismo —qué objetivo va, cuáles están
hechos, cuánto queda, quién conduce— hay que ir a leer un fichero a mano.

**Lo que se puede y lo que no.** Un plugin no dibuja panels: la interfaz del
host es del host, y lo que un plugin aporta son herramientas, recursos,
prompts, skills y hooks. Eso está comprobado en el manifiesto del host, no
supuesto. En MCode 0.6.12 el manifiesto admite exactamente estas claves:

```text
$schema, schemaVersion, name, displayName, version, description, author,
icon, darkIcon, category, exampleQueries, apps, mcpServers, skills, hooks,
hostBindings
```

Hay un `apps`, y es la única clave que se parece a una superficie gráfica: las
**Mini Apps**. Pero el host solo las carga para los plugins **oficiales**:

```text
c = e.source === "OFFICIAL" ? await Promise.all(i.apps.map(w => N7e(r, w))) : []
```

Un plugin de terceros las declara y no las tiene. Y la otra puerta, las
`hostBindings`, tampoco: su lista de superficies permitidas tiene un único
valor, `interactive` —el chat—, así que un enlace al host no puede abrir una
vista aparte.

Lo que sí quedan son superficies donde el progreso se ve:

- la **lista de tareas** del modelo, que se ve en pantalla;
- los **prompts** del servidor de herramientas, invocables con `/`;
- los **recursos** del servidor de herramientas, que se pueden abrir.

La vía real es una: que la cadena sabe decir, en texto, cómo va el ciclo; y
que ese texto llegue a una de esas superficies. Fuera del host queda una
opción complementsaria: una página HTML que el plugin escribe en local y que
el usuario abre en el navegador, con el estado del ciclo en vivo.

**Evidencia.**

- `src/plugin/mcp-server.ts` — el estado devuelve texto plano con el estado y
  el trabajo disponible, pero sin el objetivo en curso ni la cadena de
  objetivos hechos y pendientes.
- `src/plugin/auto-continue.ts` — el objetivo que se encadena lleva el
  contexto de la misión, pero no el objetivo en curso ni lo que queda por
  delante.
- Manifiesto del host 0.6.12 (`chunks/chunk-5ADYFF2U.js`): las claves
  admitidas son las de arriba; `apps` solo se carga para plugins oficiales; y
  `hostBindings[].allowedSurfaces` solo admite `interactive`. No hay ningún
  punto de extensión para dibujar un panel.

**Condición de cierre.**

- Hay una vista del ciclo activo en texto: objetivo de la misión, objetivo en
  curso con su evidencia, objetivos hechos y pendientes con su estado,
  presupuesto consumido y total, y qué camino conduce la misión.
- Esa vista se puede pedir desde la conversación y devolverse como recurso.
- El agente la refleja en su lista de tareas, de modo que el progreso queda
  a la vista sin que el usuario tenga que pedirlo.

**Alcance.** `src/plugin/mcp-server.ts`, `src/plugin/auto-continue.ts`,
`skill/goal-compass/SKILL.md`.

**Lo que se hizo.**

- `src/core/cycle-view.ts` — la vista es un módulo puro: arma los datos
  (`cycleViewOf`) y los pinta (`renderCycleView`). Vive en el dominio y no en
  el plugin porque hay dos consumidores con que coincidir: el servidor de
  herramientas y el objetivo encadenado. Si cada uno pintara su propia
  versión, el agente vería dos verdades.
- La herramienta `mission_cycle` devuelve la vista bajo demanda, y el
  recurso `goal-compass://ciclo` devuelve el mismo texto para abrirlo sin
  actuar. El servidor anuncia `resources` en `initialize` y atiende
  `resources/list` y `resources/read`.
- El objetivo encadenado lleva la vista dentro (`auto-continue.ts`), porque
  el objetivo es lo único que el host entrega al agente: si la vista no
  viaja ahí, no llega. Las listas se acotan a tres elementos y se dice
  cuántos se han dejado fuera, porque el objetivo tiene un tope de
  longitud en el host.
- `skill/goal-compass/SKILL.md` — el agente refleja la vista en su lista de
  tareas, que es la superficie donde el progreso se ve sin que nadie lo pida.
- La vista no miente: no ofrece como pendiente lo que ya se pagó ni lo que
  está en curso, y avisa cuando el presupuesto se ha superado.

**Evidencia.** `test/cycle-view.test.ts` (11 pruebas) y `test/mcp-server.test.ts`
(herramienta, recurso y recurso inexistente).

---

<a id="p15"></a>

## 15 · El director autónomo (H0–H5)

**Prioridad:** máxima · **Estado:** pendiente · **Desbloquea:** que la cadena
llegue sola al final del roadmap

**Diseño completo:** [`spec/docs/16-director-autonomo.md`](../spec/docs/16-director-autonomo.md).
Esta sección es el resumen y el índice; el spec es la referencia.

**El hueco.** La decisión más frecuente de la cadena hoy es detenerse. Un objetivo
que acaba en `blocked` o `paused` devuelve `wait` y ahí se queda; cuando no
queda candidato elegible devuelve `park` y la misión queda viva pero dormida
aunque el roadmap tenga trabajo detrás. El sentido del plugin es el contrario:
continuar hasta acabar el roadmap y la deuda.

**El invariante.** Si la misión tiene trabajo pendiente, el sistema debe poder
demostrar una de dos cosas: que ejecuta una acción que contribuye a completarlo,
o qué **condición externa verificable** impide cualquier acción autorizada. Una
tarea bloqueada nunca justifica por sí sola detener la misión completa.

**Las tres situaciones.** Hay trabajo realizable → continuar con el mejor
candidato. Un trabajo está bloqueado → recuperar: investigar, descomponer, cambiar
de estrategia o **elegir otro trabajo**. No existe ninguna acción autorizada y
realizable → esperar una condición externa, conservando la misión.

Las órdenes explícitas de detener o pausar, los permisos y las cuotas reales se
respetan siempre. Ser autónomo no es poder ignorarlos.

**Lo que no se toca.** El supervisor ACP, la skill con frontmatter, el grafo, los
adaptadores y el journal siguen siendo la base. Lo que cambia es la política que
los conecta, más el árbol de este proyecto —ya escrito en `.goal-compass/`— y el
journal, que además de Goals guardará decisiones y experimentos.

**Los hitos.**

| Hito | Versión | Alcance | Aceptación |
|---|---|---|---|
| **H0** | v0.15.0 | Cerrar P0/P1: lockfile, conciliación de estados, keeper, control, recuperación | Un Goal recupera su estado sin duplicar y el producto instala limpio |
| **H1** | v0.16.0 | Selector que busca alternativas y desbloqueos antes de esperar | Una tarea bloqueada con trabajo alternativo nunca paraliza la misión |
| **H2** | v0.17.0 | Árbol YAML ejecutable: señales tipadas, resultados estructurados, rutas de recuperación | El agente sigue caminos distintos según evidencia observable |
| **H3** | v0.18.0 | Roadmap agent-first: consultar, modificar, priorizar, descomponer y cerrar desde prompts | El agente modifica el roadmap y demuestra por qué cada tarea nueva pertenece a la misión |
| **H4** | v0.19.0 | Experimentos con evaluación y memoria, crítica independiente, replanificación | Un fallo o una investigación fallida produce conocimiento o estrategia nueva, no un ciclo repetido |
| **H5** | v0.20.0 | Modo persistente opcional, recuperación entre sesiones, auditoría global, publicación gobernada | Completar un roadmap de varios hitos con reinicios, cambios de prioridad, entregas y comprobación final |

H0 y H1 son el cambio decisivo: pasar de un plugin que interpreta «no puedo
ejecutar el siguiente Goal» como una razón para esperar, a uno que pregunta
sistemáticamente «qué tengo que averiguar, corregir o reorganizar para poder
continuar». H3 y H4 lo convierten en un sistema agent-first de planificación;
H5 le da persistencia más allá de una sesión.

**Defectos concretos que ya están observados y son de H0.**

- `src/runtime.ts:158` — `existing?.mission ?? toMission(config)`: en cuanto hay
  journal, la misión sale de ahí y **la declaración nunca se vuelve a leer**. El
  backlog queda congelado el día que se creó el journal; añadir o repriorizar un
  candidato no llega ni al estado ni a la cadena.
- `src/adapters/candidates.ts:32` — el puerto recarga la declaración sin
  `workspace`, lo que lanza, y el `catch` se come el error y cae al backlog del
  journal. El mismo hueco por otro lado.

**Nota de alcance.** El árbol de decisiones de este proyecto ya está escrito en
`.goal-compass/` (11 nodos: `grill`, `spec`, `tickets`, `implement`, `review`,
`unblock`, `finish`, `stop` y los dos nodos de control) y valida con
`node dist/cli.js tree`. Lo que falta es que el runtime lo ejecute: H2.
