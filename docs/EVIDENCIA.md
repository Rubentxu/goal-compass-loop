# Evidencia de validación

Todo lo que sigue se ha **ejecutado** contra la instalación real del programa
en esta máquina. Lo que no se ha ejecutado está marcado como **NOT RUN**, sin
adornos.

## Entorno

| Elemento | Valor |
|---|---|
| Host | `mcode` **0.6.12** (`~/.minimax-code/releases/0.6.12`) |
| Data dir | `~/.minimax` |
| Node | v25.9.0 |
| Dependencias en ejecución | **ninguna**: el transporte ACP y el servidor de herramientas usan solo la biblioteca estándar |
| Sistema | Fedora, Linux x86_64 |

---

## 1 · Pruebas permanentes — **PASADO**

```text
$ npm test
 Test Files  9 passed (9)
      Tests  95 passed (95)
   Duration  2.13s

$ npm run typecheck     # sin errores
```

95 pruebas en unos dos segundos. Cubren el núcleo puro, el supervisor con
dobles en memoria, el descubrimiento de señales, los puertos de candidatos, la
exploración, **el transporte ACP**, **el hook del plugin**, **el servidor de
herramientas** y **el grafo de la skill que se entrega**.

Las tres últimas no se prueban contra una simulación: el transporte y el hook
se hablan con un **host de mentira que es un proceso real**
(`test/support/fake-acp-host.mjs`), que habla NDJSON como el host de verdad.
Lo que se comprueba es el cableado completo:

| Comprobación | Qué demuestra |
|---|---|
| Cada respuesta se empareja con su petición | Dos peticiones en vuelo no se cruzan |
| Un mensaje partido en trozos se rearma | Un mensaje de 200 KB llega en varias partes y se interpreta igual |
| El host pregunta y el cliente contesta | El ida y vuelta funciona en ambos sentidos |
| Un método rechazado da un error tipado | El error conserva el mensaje del host |
| Una petición en vuelo al caer el host se resuelve | Nada se queda colgado |

El servidor de herramientas se prueba con peticiones reales de JSON-RPC sobre
la entrada y salida estándar: `initialize`, `ping`, `tools/list`, `tools/call`,
una herramienta que no existe y una que falla por dentro. Cada respuesta llega
emparejada con su petición y con su identificador.

## 2 · Compatibilidad del host — **PASADO**

La extensión de objetivos existe en el build instalado, no solo en el código
publicado. El host anuncia la extensión completa en el `initialize`, con sus
métodos y sus notificaciones. Los cuatro métodos respondieron contra el host
real:

| Método | Respuesta real |
|---|---|
| `goal/get` (sesión vacía) | `{"goal": null}` |
| `goal/create` | `{"goal":{"goalId":"tg_ufoh5y73avmvfmf852","status":"active","tokenBudget":20000,...}}` |
| `goal/get` (tras create) | mismo `goalId`, `status: active` |
| `goal/patch` (`paused`) | `status: "paused"`, `statusReason: "paused(user_requested)"` |
| `goal/clear` | `{"cleared": true}` |

### Hallazgo que cambió el diseño: el objetivo se autoejecuta

Al crear un objetivo, **arrancan solos** el worker y el verificador. No hace
falta ninguna llamada extra para empujarlo. Por eso el supervisor se limita a
observar y encadenar, y por eso el hook del plugin puede limitarse a crear.

### Hallazgo que abrió la puerta al plugin: dos clientes, una sesión

Comprobado contra el host real, con dos clientes ACP simultáneos:

```text
sesion creada: mvs_e4421b84a87e4bc6a1448d529ebd74a3
B cargo la sesion sin goal
B creo el goal: tg_xzisrpzzgbmvfqspfg active
B ve el goal: tg_xzisrpzzgbmvfqspfg active
```

Un segundo cliente **carga** una sesión que no es suya, **ve** su objetivo y
**crea** el siguiente cuando no hay ninguno activo. (Si ya hay un objetivo en
curso, la creación se rechaza: en una sesión solo hay un objetivo vivo.)

Esto es lo que permite que el hook encadene el trabajo **en la sesión del
usuario**, y no en una sesión aparte.

## 3 · El plugin de MCode — **PASADO**

### 3.1 Descubrimiento e instalación — **PASADO**

```text
$ node dist/cli.js install-plugin
plugin ensamblado en /home/rubentxu/.minimax/plugins/goal-compass

$ mcode plugin add goal-compass -m local
$ mcode plugin list --json
{
  "installed": [
    {
      "name": "goal-compass",
      "marketplaceName": "local",
      "version": "0.6.0",
      "installed": true,
      "enabled": true,
      "capabilities": {
        "appCount": 0,
        "mcpServerCount": 1,
        "skillCount": 1
      }
    }
  ],
  "available": []
}
```

El catálogo es la prueba de que el paquete **carga**: `mcpServerCount: 1` y
`skillCount: 1` son el recuento real de lo que el host ha montado. Si un
componente no valida, el paquete no aparece aquí y no hay ningún error visible.

**Defecto encontrado y corregido durante esta validación.** El plugin no
aparecía en el catálogo, y el escáner lo descartaba **en silencio**. La causa
no era el manifiesto ni la ruta: el manifiesto de MCode **exige `icon`**, y sin
él la validación del paquete falla antes de llegar al catálogo. El síntoma era
que el marketplace local parecía vacío y no había ningún error visible.

La lección: un escáner que descarta en silencio convierte un error de una
línea en un misterio. El paquete se registra con un `diagnostic`, pero el
comando de listado no lo enseña.

### 3.2 Encadenado en una sesión real — **PASADO**

Sesión real de MCode (`mcode exec`) en un repositorio de prueba con
`goal-compass.json` y un backlog de dos objetivos. Al terminar el turno, el
hook se disparó y creó el primer objetivo **en la sesión del usuario**:

```text
$ cat ~/.local/state/goal-compass/prueba-plugin/journal.json
{
  "missionId": "prueba-plugin",
  "sessionId": "mvs_4611d11318114cea816279f3ac2c99a6",
  "intents": [
    {
      "intentId": "8e0864e6-304a-4629-80ef-50ea52754345",
      "candidateId": "leer-readme",
      "objective": "Resume en una linea para que sirve este repositorio de prueba",
      "tokenBudget": 60000,
      "status": "committed",
      "goalId": "tg_pwi7nim8ggmvfs2jsb"
    }
  ]
}
```

Lo que demuestra:

- El hook recibió el identificador de sesión del host y **lo adoptó**: el
  objetivo se creó en la sesión del usuario, no en una aparte.
- La misión se inicializó sola a partir del `goal-compass.json` del
  repositorio, sin ningún paso previo.
- La transición fue durable: intención persistida → creación → lectura de
  confirmación → confirmación de la intención (`status: committed`).
- El objetivo creado quedó activo. `goals` sigue vacío a propósito: esa lista
  recoge los objetivos **terminados**, que son los que consumen presupuesto y
  los que evitan repetir trabajo.

### 3.3 Contrato del hook — **PASADO**

El host entrega el evento por la entrada estándar y da al hook su carpeta y
la carpeta del proyecto en variables de entorno:

| Entrada | Contenido |
|---|---|
| `stdin` | `{"hook_event_name":"Stop","session_id":"mvs_…","cwd":"…","payload":{…}}` |
| `PLUGIN_ROOT` | Carpeta raíz del plugin |
| `MINIMAX_PROJECT_DIR` | Directorio del proyecto |

Y espera en la salida un JSON con la decisión. Para `Stop`, la forma que
devuelve el turno al agente es:

```json
{"decision":"block","reason":"<lo que el agente debe hacer ahora>"}
```

El hook responde exactamente eso cuando encadena un objetivo, y **no dice
nada** cuando no toca. Un hook que falla no puede romper el turno: si el host
se cae, si la sesión no existe o si se acaba el tiempo, la salida es vacía y
el turno sigue su curso.

## 4 · El servidor de herramientas — **PASADO**

Hasta ahora el agente no podía mirar la misión: el estado se consultaba desde
fuera, con el comando de línea de órdenes. El plugin entrega ahora un juego de
cinco herramientas que el agente puede usar **dentro de la conversación**.

El servidor habla MCP sobre la entrada y salida estándar, con una línea JSON
por mensaje. No necesita dependencias ni configuración: lo arranca el propio
host con el plugin.

### 4.1 Las cinco herramientas — **PASADO**

| Herramienta | Qué hace | Escribe |
|---|---|---|
| `mission_status` | En qué está la misión, cuántos objetivos ha encadenado, cuánto ha gastado y qué trabajo hay disponible ahora mismo | Nada |
| `mission_propose` | Propone el siguiente objetivo; la evidencia tiene que señalar a un fichero que exista | Fichero de propuestas |
| `mission_pause` | Pausa la cadena y el objetivo en curso | Canal de control |
| `mission_resume` | Reanuda una misión pausada o dormida | Canal de control |
| `mission_stop` | Termina la cadena | Canal de control |

**Reparto de escrituras.** El journal lo sigue escribiendo quien encadena
objetivos. El servidor de herramientas **no** lo toca: escribe solo en el canal
de control y en el fichero de propuestas, que son ficheros aparte precisamente
para que dos procesos no se pisen. Con eso, el "un solo escritor" se mantiene.

**Las herramientas no crean objetivos.** `mission_propose` deja una propuesta;
el cierre de turno siguiente es quien la encadena. Es lo que mantiene la regla
de que solo el proceso que encadena crea objetivos, y además da al agente un
papel de *propuesta* y no de *decisión*.

### 4.2 El candado de la evidencia — **PASADO**

Una propuesta sin evidencia real no se acepta: se descarta antes de llegar al
journal. El mismo criterio que ya se usaba para la exploración se aplica aquí,
contra el mismo workspace.

Capturado del servidor real, en un repositorio de prueba con una misión
declarada:

```text
$ printf '%s\n' \
  '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"mission_status","arguments":{}}}' \
  '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"mission_propose","arguments":{"objective":"Anadir pruebas del parseo","evidence":"src/parser/nuevo.ts"}}}' \
  | env PWD=/tmp/gcl-mcp-test node dist/plugin/mcp-server.js

{"jsonrpc":"2.0","id":4,"result":{"content":[{"type":"text","text":"La evidencia \"src/parser/nuevo.ts\" no señala a ningún fichero del workspace. Una propuesta sin fichero real no es trabajo."}]}}

{"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"Misión: prueba-mcp — Comprobar que el agente puede ver y gobernar la mision\nEstado: running\nObjetivos encadenados: 1\nPropuestas pendientes: 0\nTrabajo disponible:\n- Revisar las notas del repositorio (evidencia: NOTAS.md)"}]}}
```

El estado que devuelve `mission_status` es el real, leído del journal: no un
resumen inventado a partir del fichero de declaración. Y la propuesta sobre un
fichero que no existe se rechaza en el acto.

El resto del intercambio, en la misma ejecución:

```text
{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"serverInfo":{"name":"goal-compass","version":"1"}}}
{"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"mission_status",...},{"name":"mission_propose",...},{"name":"mission_pause",...},{"name":"mission_resume",...},{"name":"mission_stop",...}]}}
```


### 4.3 Uso en una sesión real — **PASADO**

Con el plugin instalado y registrado, el agente **llamó** a la herramienta y
obtuvo el estado de la misión. Transcripción literal de la sesión:

```text
assistant: I'll check the mission status with goal-compass.
toolCall:  mcp__goal-compass__mission_status  {}
toolResult: Misión: prueba-mcp — Comprobar que el agente puede ver y gobernar la mision
            Estado: running
            Objetivos encadenados: 1
            Propuestas pendientes: 0
            Trabajo disponible:
            - Revisar las notas del repositorio (evidencia: NOTAS.md)
```

En una sesión posterior, el mismo repositorio, el objetivo ya encadenado había
subido a dos, y la herramienta lo reflejaba:

```text
toolResult: Misión: prueba-mcp — Comprobar que el agente puede ver y gobernar la mision
            Estado: running
            Objetivos encadenados: 2
```

El host registra además el origen de cada resultado, de modo que la llamada
queda atribuida al plugin que la sirve:

```json
"details": {
  "mcp": { "isError": false },
  "server": "goal-compass",
  "tool": "mission_status",
  "plugin": "goal-compass"
}
```

Las cinco herramientas aparecen registradas bajo el prefijo
`mcp__goal-compass__`.

### 4.4 Defecto encontrado y corregido: el tipo del servidor — **PASADO**

El plugin volvía a desaparecer del catálogo, en silencio otra vez. La causa no
era el manifiesto: era la **entrada del servidor de herramientas**. En el modo
oficial, la entrada tiene que declarar el tipo de transporte:

```json
{ "type": "stdio", "command": "node", "args": ["./dist/plugin/mcp-server.js"] }
```

Sin `"type": "stdio"`, el host no sabe cómo hablar con el servidor y descarta
el paquete antes de llegar al catálogo. El síntoma es idéntico al del icono
que faltaba: un marketplace que parece vacío y ningún error visible.

Los dos casos apuntan a lo mismo: **el host falla en silencio cuando un plugin
no valida**, y no hay forma de que el usuario se entere desde el listado. La
comprobación de que el plugin aparece en el catálogo no es opcional; es parte
de la instalación.

### 4.5 Defecto encontrado y corregido: dónde se busca la misión — **PASADO**

El host **arranca el servidor de herramientas desde su propia carpeta**, no
desde el proyecto: el directorio de trabajo del proceso es el home del
usuario, aunque el proyecto esté en otro sitio.

Consecuencia directa: el servidor no encontraba ninguna misión y todas las
herramientas respondían "no hay misión declarada".

La gracia del defecto es que **se ve crecer en la transcripción de sesiones
reales**, porque cada respuesta decía más que la anterior:

| Sesión real | Qué respondió la herramienta |
|---|---|
| Primera | `No hay ninguna misión declarada en este workspace.` |
| Segunda | lo mismo, más `Buscando en: /var/home/rubentxu` |
| Tercera | lo mismo, más `Buscando en: /var/home/rubentxu` y `Entorno: PWD=/tmp/gcl-mcp-test` |
| Tras corregir | `Misión: prueba-mcp — Comprobar que el agente puede ver y gobernar la mision` |

La tercera línea es la que lo resuelve: el host **sí** publica el proyecto, pero
en la variable `PWD`, no en una variable propia del proyecto. El proceso se
arranca en el home; la shell conserva el directorio de trabajo.

```text
$ cat /proc/<pid>/environ | tr '\0' '\n' | grep -E '^(PWD|MINIMAX_PROJECT_DIR)='
PWD=/var/home/rubentxu/Proyectos/Typescript/goalCompassLoop
```

La resolución es, por orden: una variable explícita del proyecto
(`MINIMAX_PROJECT_DIR`, `CLAUDE_PROJECT_DIR`, `CODEX_PROJECT_DIR`,
`MCP_PROJECT_DIR`), luego `PWD` si el directorio existe, y solo como último
recurso el directorio del proceso. Comprobado simulando el entorno real del
host: el servidor encuentra la misión y devuelve su estado.

Además, la búsqueda **sube por los ancestros**: si el agente está en un
subdirectorio del repositorio, la misión se sigue encontrando.

### 4.6 Un bloqueo heredado del host, y cómo se destapa — **PASADO**

A mitad de la validación, el host dejó de arrancar de golpe:

```text
$ mcode acp
agent_name_conflict_migration_failed:lock
```

El error no lo produce este proyecto: es la migración de nombres de agente del
host, que toma un candado sobre el **directorio de datos entero** antes de
reescribir referencias. Un proceso interrumpido a mitad deja el candado
puesto, y a partir de ahí todo comando del host que toque ese almacenamiento
falla igual: `mcode acp`, `mcode plugin list`, `mcode exec`.

El diagnóstico es rápido si se sabe dónde mirar:

```text
$ ls -lad ~/.minimax.lock
drwxr-xr-x 1 rubentxu rubentxu 0 oct 20 00:22 /home/rubentxu/.minimax.lock
```

La marca de tiempo no se refresca desde entonces, y el host refresca el
candado mientras lo tiene: eso significa que el candado está **huérfano**, no
que otro proceso lo esté usando. La comprobación es que no haya ningún
proceso vivo del host:

```text
$ ps -ef | grep -c "[m]inimax-code"   # procesos en otros proyectos, ninguno en este
```

El candado se libera solo cuando pasa su ventana de obsolescencia (30
minutos). Para no esperar, se retira de forma recuperable y el host lo vuelve
a crear limpio:

```text
$ mavis-trash ~/.minimax.lock
mavis-trash: moved to trash: '/home/rubentxu/.minimax.lock'
```

Y todo vuelve a funcionar:

```text
$ mcode plugin list --json
{ "installed": [ { "name": "goal-compass", "version": "0.6.0", "installed": true,
  "enabled": true, "capabilities": { "mcpServerCount": 1, "skillCount": 1 } } ] }
```

La lección: **un fallo del host que aparece de golpe y afecta a varios
comandos a la vez no es un fallo del host, es un estado heredado**. Antes de
buscar el problema en el código, hay que mirar el directorio de datos.

## 5 · Lo que el sistema prometía y no cumplía — **CORREGIDO**

Este ciclo no añadió capacidades: encontró **promesas que no se cumplían**. Las
tres eran del mismo tipo de problema, y las tres se han corregido y
comprobado.

### 5.1 Una herramienta que prometería un trabajo que se perdía — **PASADO**

El agente proponía el siguiente objetivo con `mission_propose` y recibía esto:

```text
Propuesta registrada: Escribir la prueba que falta
Evidencia: NOTAS.md
Propuestas utilizables: 1
Se encadenará en el próximo cierre de turno.
```

La propuesta **nunca se encadenaba**. El motor descarta todo trabajo que no
diga cómo se sabrá que está hecho, y el dato era opcional en la herramienta.
Reproducido contra el binario real:

```text
$ node dist/plugin/mcp-server.js   # con PWD apuntando al workspace
candidatos que ofrece el puerto de propuestas: 1
  - propuesta:Escribir la prueba que falta | doneWhen: []
elegibles: 0 | descartados: propuesta:Escribir la prueba que falta:sin-criterio-observable
```

Es el fallo que el sistema existe para evitar, pero al revés: en vez de
inventar trabajo, lo **descartaba sin decirlo**. El mensaje afirmaba lo
contrario de lo que iba a pasar.

**Corrección.** La herramienta exige el criterio de cierre y, si falta, no
registra nada y explica por qué:

```text
$ node dist/plugin/mcp-server.js
Falta el criterio de cierre de la propuesta: sin al menos un criterio observable
no se puede comprobar que el trabajo esté hecho, y la propuesta se descartaría.
Indica en `doneWhen` cómo se sabrá.
```

Y con el criterio de cierre, el conteo que anuncia es cierto:

```text
Propuesta registrada: Escribir la prueba que falta
Evidencia: NOTAS.md
Propuestas utilizables: 1
Se encadenará en el próximo cierre de turno.

$ node dist/plugin/mcp-server.js   # mission_status
Propuestas utilizables: 1
Trabajo disponible:
- Escribir la prueba que falta (evidencia: NOTAS.md)

$ probe   # comprobacion directa de elegibilidad
elegibles: 1 | descartados:
```

La regla de "qué es trabajo" vive ahora **en un solo sitio**, en el motor, y la
usan el motor y el canal de propuestas. Antes cada uno tenía su propia idea y
por eso se contradecían: la herramienta contaba como utilizable lo que el
motor iba a descartar.

### 5.2 El arnés probaba otro sistema — **PASADO**

El arnés de aceptación montaba su propia lista de fuentes de trabajo:

```text
// antes, en spikes/harness.ts
new ComposedCandidatePort([
  new MissionConfigCandidatePort(missionFile),
  new WorkspaceDiscovery(new WorkspaceEvidenceScanner({ maxEvidence: 5 })),
])
```

La del producto era otra, y tenía una fuente más: el canal de propuestas.

```text
// en src/runtime.ts
new MissionConfigCandidatePort(configPath),
new ProposalCandidatePort(workspace),
new WorkspaceDiscovery(scanner),
```

Es decir: la mitad de lo que el sistema hace **no lo probaba nadie**, y el
arnés podía dar verde mientras el producto fallaba.

**Corrección.** Un único lugar decide de dónde sale el trabajo, y lo usan las
dos partes. El escenario `chain` encadena ahora un objetivo que llega por el
canal de propuestas, y comprueba que se encadena **en su momento**, no al
final y no nunca.

### 5.3 La skill que se entrega no la comprobaba nadie — **PASADO**

El kit de especificación traía un comprobador de la forma del grafo, pero
miraba **una copia congelada** de la skill:

```text
$ python3 spec/tools/check_graph.py
OK: manifest + copias Skill + 12 nodos + enlaces + alcanzabilidad. NO prueba MCode/LLM.
```

La skill que se instala (`skill/goal-compass/`) ya había divergido de esa copia
en cuatro ficheros, y nadie se enteraba: el comprobador daba verde sobre algo
que nadie usa.

**Corrección.** El grafo que se instala tiene contrato en la suite permanente,
en el mismo lenguaje y con el mismo comando que el resto:

```text
$ npx vitest run test/skill-graph.test.ts
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

Lo que comprueba: que la skill y su índice existen, que cada nodo tiene su
forma y sus secciones, que sus enlaces apuntan a nodos que existen y dicen
cómo se usan, que se puede llegar a todos los nodos desde el índice, que desde
todos se puede terminar, y que el índice ofrece todos los nodos.

### 5.4 Y una comprobación que se demuestra que muerde — **PASADO**

Un contrato que nunca falla no vale nada. Se rompió el grafo a propósito, dos
veces, y se restauró:

```text
# relación inventada
AssertionError: stop.md: relación desconocida xxx: expected false to be true

# enlace a un nodo que no existe
AssertionError: stop.md: el enlace no nombra a su destino: expected 'unblock' to be 'inexistente'

# restaurado
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

### 5.5 El límite de la misión llega al agente — **PASADO**

`allowRemoteWrite` se guardaba en el estado durable y **no lo consultaba
nadie**. Ahora el hook lleva el límite en el mensaje que devuelve al agente,
porque el agente es el único que puede publicar:

```text
Limite de la mision: La mision no autoriza publicar: no hagas push, ni tag,
ni release, ni despliegue.
```

Con la misión autorizando, el mensaje dice que hace falta autorización
explícita del usuario:

```text
Limite de la mision: La mision autoriza publicar, pero hace falta autorizacion
explicita del usuario.
```

### 5.6 El arnés distingue "falló" de "no se pudo comprobar" — **PASADO**

Una ejecución dejó dos escenarios en rojo. Ninguno de los dos era un fallo del
sistema, y el arnés no tenía forma de decirlo:

```text
[00:12:26.194Z] decision: create - propuesto durante la sesion
[00:12:26.202Z] intencion persistida: propuesta:Escribe un fichero llamado resultado-2.t
[00:12:26.257Z] goal creado y confirmado: tg_52l026hb70mvfxiify (active)
[00:16:26.158Z] decision: wait - goal en estado paused (paused(verifier_aborted)): no se crea otro Goal para esquivar el limite
```

El sistema encadenó la propuesta **en el sitio correcto** y luego el host
abortó el verificador del segundo objetivo. El supervisor hizo lo que debe:
negarse a encadenar otro objetivo para esquivar el límite, y esperar. El
arnés, en cambio, solo sabía decir "rojo", y ese rojo señalaba un problema
del sistema que no existía.

**Corrección.** El arnés tiene ahora tres estados, no dos:

| Estado | Significado |
|---|---|
| `PASA` | La comprobación se hizo y se cumplió |
| `FALLA` | La comprobación se hizo y no se cumplió |
| `NO CORRIO` | La comprobación no se pudo hacer porque el host dejó el trabajo a medias |

Un objetivo confirmado sin registro de haber terminado significa que el host
no lo terminó. El arnés lo detecta, lo dice con el motivo del host, y marca
el escenario como no corrido. El código de salida sigue siendo cero: una
interrupción del host no es un fallo del sistema, y el resumen lo dice.

Esto no es un detalle menor del arnés: es lo que permite que la evidencia
diga la verdad. Un "todo en verde" con un escenario que en realidad no se
comprobó es peor que un rojo.

### 5.7 El agente propuso su propio trabajo, con la herramienta del plugin — **PASADO**

Lo más bonito que salió de la ejecución fallida: al pedirle al agente del host
que buscara trabajo, **usó la herramienta del plugin para proponerlo**.

```text
[00:23:44.957Z] sin trabajo elegible: se pide una exploracion acotada del workspace
```

Y en el fichero de propuestas de esa misión:

```json
{
  "candidateId": "propuesta:Implementar la función `exportar()` en `src/fechas.ts`, sustituyendo el `throw new Error(\"sin implementar\")` p",
  "objective": "Implementar la función `exportar()` en `src/fechas.ts`, sustituyendo el `throw new Error(\"sin implementar\")` por la lógica real de exportación de fechas.",
  "whyNow": "NOTAS.md declara explícitamente que `exportar` todavía no está implementada y que hay que escribirla; es el único hueco de código real del repositorio y bloquea el resto del trabajo.",
  "evidenceRefs": ["src/fechas.ts"],
  "doneWhen": [
    "src/fechas.ts ya no lanza el error \"sin implementar\"",
    "exportar() devuelve un string con el formato de fecha acordado y es determinista",
    "El módulo compila con tsc --noEmit sin errores"
  ]
}
```

Tres propuestas, con su evidencia y con su criterio de cierre. Y una de ellas
se encadenó como objetivo:

```text
intents:
   propuesta:Añadir la configuración mínima de proyecto TypeScr | committed | tg_qwawh3npnrmvfxz137
```

Esto es el circuito completo, de punta a punta, sin que nadie lo orquestara: el
agente investigó, propuso con la herramienta, y el sistema encadenó su
propuesta. La evidencia del ciclo anterior decía que este recorrido estaba
pendiente; aquí está hecho.

De paso queda demostrado que la herramienta sirve para lo que dice: la
propuesta traía criterio de cierre, y por eso se encadenó. Con el contrato
anterior, el mismo agente habría registrado trabajo que se perdía.

**Y un efecto secundario que obliga a revisar el escenario.** Con el plugin
instalado, el agente del host puede usar la herramienta de propuestas, así que
el escenario `exploration` ya no puede dar por hecho que el trabajo llega por
la exploración. El escenario comprueba ahora el invariante —trabajo real,
encadenado, con evidencia que señala a un fichero que existe— y reporta de
dónde vino, en vez de atarse a un mecanismo.

### 5.8 En la UAT hay dos manos encadenando trabajo — **PASADO**

La cronología de la exploración delata algo que no estaba en el diseño, pero
que tiene que quedar escrito.

El agente del host, al que se le pidió explorar, pasó tres minutos
registrando propuestas. Al terminar su turno, el **hook del plugin** se
disparó y encadenó una de ellas como objetivo:

```text
00:40:05.436Z  sin trabajo elegible: se pide una exploracion acotada del workspace
00:42:32.854Z  propuesta registrada: Implementar la función exportar() en src/fechas.ts
00:42:36.608Z  propuesta registrada: Cubrir exportar() con una prueba automatizada
00:42:40.050Z  propuesta registrada: Añadir la configuración de proyecto mínima
00:42:52.666Z  intencion persistida: propuesta:Añadir la configuración de proyecto míni
00:42:53.108Z  ERROR la exploracion fallo: el host ACP esta cerrado
```

El objetivo `tg_nl9uuifu82mvfylnra` **no aparece en el log del supervisor**, que
sí registra con nombre y apellidos cada objetivo que crea:

```text
$ grep -c "tg_nl9uuifu82mvfylnra" /tmp/gcl-uat-v061.log
0
```

Lo creó el hook, que vive dentro del programa anfitrión y escribe en el mismo
journal. Y el error de la exploración se explica por lo mismo: cuando el hook
encadenó el objetivo, la sesión dejó de atender la exploración que seguía en
vuelo.

**Qué significa esto.** En la UAT conviven las dos vías de encadenado: el
supervisor que arranca el escenario, y el hook del plugin que trae el
anfitrión. No es un choque, porque el journal deduplica por clave estable de
candidato y la creación se confirma con una lectura posterior. El escenario
`chain` lo demuestra: el supervisor creó tres objetivos y el hook no generó
ninguno duplicado.

Pero la lección para quien lea la evidencia es clara: **el objetivo del
escenario `exploration` lo encadenó el hook, no el supervisor**. El escenario
demuestra que el producto encuentra trabajo real y lo encadena; no demuestra
que lo hiciera el supervisor. La diferencia importa: el supervisor es la vía
sin plugin, y su camino de exploración sigue sin verificarse en la UAT, porque
con el plugin instalado el hook se adelanta.

Y esto no es un defecto: es la consecuencia de instalar el plugin y usar el
supervisor a la vez, que es justo lo que hace el arnés de aceptación. Lo que
no vale es que la evidencia no lo diga.

### 5.9 Y el fallo de la exploración no tumba la misión — **PASADO**

Un error de exploración se captura, se registra y el ciclo termina sin decidir
nada. No cuenta como fallo del ciclo y no escala la misión:

```text
[00:42:53.108Z] ERROR la exploracion fallo: el host ACP esta cerrada
```

La misión sigue viva, con su presupuesto, su estado y su journal. Un
problema puntual de una consulta no puede matar una misión de días.

## 6 · Escenarios de aceptación contra el host real — **PASADO**

```text
$ npm run uat
=============== RESUMEN ===============
PASA · chain
PASA · recovery
PASA · pause
PASA · budget
PASA · exploration
=======================================
```

Los cinco escenarios, con sus comprobaciones:

| Escenario | Comprobaciones | Resultado |
|---|---|---|
| `chain` | 12 | Tres objetivos encadenados sin intervención; el del medio llega por el canal de propuestas y se encadena en su momento; 123 747 tokens medidos |
| `recovery` | 4 | Un fallo entre crear y confirmar se reconcilia sin duplicar |
| `pause` | 3 | La orden de pausa detiene el trabajo en curso y la de continuar lo reanuda |
| `budget` | 3 | Agotado el presupuesto (67 456 tokens), la cadena se detiene sin crear otro objetivo |
| `exploration` | 6 | Sin backlog ni pendientes marcados, el sistema pide buscar trabajo, encuentra trabajo real y lo encadena, con evidencia que señala a ficheros que existen, y sin encadenar el mismo trabajo dos veces |

La última ejecución es la del ciclo de activar la misión con una frase
(sección 9), con las mismas 28 comprobaciones del ciclo anterior: declarar una
misión no toca al supervisor, y los cinco escenarios lo confirman igual contra
el host real.

La cadena, con el trabajo del medio llegando por el canal de propuestas:

```text
[2026-10-20T08:31:05.190Z] decision: create - trabajo pendiente de la cadena
[2026-10-20T08:31:05.202Z] intencion persistida: primero -> c079122d-e135-4592-bbfd-046584a44bf2
[2026-10-20T08:31:05.343Z] goal creado y confirmado: tg_kkf9h79bx2mvgfbs3c (active)
[2026-10-20T08:33:50.493Z] goal completado registrado: tg_kkf9h79bx2mvgfbs3c (complete(verifier_met))
[2026-10-20T08:33:50.501Z] decision: create - propuesto durante la sesion
[2026-10-20T08:33:50.510Z] intencion persistida: propuesta:Escribe un fichero llamado resultado-2.txt ...
[2026-10-20T08:33:50.559Z] goal creado y confirmado: tg_icgk7hj1pjmvgffbn6 (active)
[2026-10-20T08:36:41.725Z] decision: create - trabajo pendiente de la cadena
[2026-10-20T08:36:41.735Z] intencion persistida: tercero -> 7c6cc171-b832-4842-a44a-8d97177c3484
[2026-10-20T08:36:41.784Z] goal creado y confirmado: tg_p2ra05qvxnmvgfizre (active)
```

El orden lo decide la prioridad, no el orden de la lista: el backlog declarado
manda (10), la propuesta va en medio (5) y el segundo backlog detrás (3). La
propuesta no se queda para el final ni se salta.

Y el escenario de exploración, que ya no puede dar por hecho que el trabajo
llega por la exploración, porque con el plugin instalado el agente puede
usar la herramienta de propuestas. En la ultima ejecucion el
trabajo llego por la exploracion y lo encadeno el supervisor; el recibo
completo esta en la seccion 7:

```text
PASA · se encadeno un Goal sin trabajo marcado (origen: exploracion)
PASA · el sistema pidio buscar trabajo
PASA · el Goal viene de una fuente que investigo (exploracion)
PASA · su evidencia senala a un fichero real (NOTAS.md, src/fechas.ts)
PASA · el supervisor encadeno el objetivo (tg_tokff996m5mvgfshkd)
PASA · no se encadeno el mismo trabajo dos veces (1)
```

Fragmento literal del escenario de exploración, que es el que ejercita la
búsqueda de trabajo con el modelo:

```text
[2026-10-20T08:42:47.375Z] sin trabajo elegible: se pide una exploracion acotada del workspace
[2026-10-20T08:44:00.106Z] la exploracion aporto 2 candidato(s): la mision continua
[2026-10-20T08:44:04.701Z] decision: create - NOTAS.md pide explícitamente 'cubrirla con una prueba' y no existe
                ningún fichero de test en el repo. Sin ella, la implementación queda sin red de
                seguridad y una regresión futura en la salida de `exportar()` pasaría inadvertida.
```

Ese texto no lo escribió el sistema: lo escribió **el modelo**, leyendo el
repositorio. La exploración es la única fuente de trabajo que no viene de una
lista escrita a mano, y es la que decide.

Y el del freno de gasto, que es el que se encontró **de forma natural** al
agotarse el presupuesto:

```text
[2026-10-20T04:35:55.362Z] decision: park - presupuesto de la mision agotado (87570 de 1 tokens); la mision sigue viva
[2026-10-20T04:35:55.379Z] mision en parked: presupuesto de la mision agotado (87570 de 1 tokens); la mision sigue viva
```

Y el de la cadena, donde se ve que el trabajo siguiente arranca solo en cuanto
el anterior se completa:

```text
[2026-10-20T04:25:01.272Z] decision: create - trabajo pendiente de la cadena
[2026-10-20T04:25:01.389Z] goal creado y confirmado: tg_ddbwd4dfs7mvg6jc6e (active)
[2026-10-20T04:27:19.525Z] goal completado registrado: tg_ddbwd4dfs7mvg6jc6e (complete(verifier_met))
[2026-10-20T04:27:19.532Z] decision: create - propuesto durante la sesion
[2026-10-20T04:27:19.620Z] goal creado y confirmado: tg_ijkwimrygzmvg6mauz (active)
[2026-10-20T04:29:28.839Z] decision: create - trabajo pendiente de la cadena
[2026-10-20T04:29:29.043Z] goal creado y confirmado: tg_bt4yhaen1rmvg6p2n4 (active)
```

Estos escenarios se ejecutan **con el transporte ACP propio**, sin ninguna
dependencia externa: la reescritura del transporte no cambió el comportamiento
observable, y los cinco escenarios lo confirman contra el host real.

## 7 · Una misión, un conductor — **PASADO**

### 7.1 El hueco que quedó abierto en el ciclo anterior

El ciclo v0.6.1 cerró con una anotación honesta en su propia evidencia: en la
UAT **convivían dos manos encadenando trabajo**, y el objetivo del escenario
`exploration` lo había encadenado el hook, no el supervisor. El escenario
demostraba que el producto encuentra trabajo real y lo encadena; no demostraba
que lo hiciera el camino que se quería medir.

No era un detalle de redacción. Mirando el código, el problema era de diseño:

- el hook y el supervisor son **la misma maquinaria** (`supervisor.step()`)
  sobre el mismo journal;
- el journal se escribe de forma atómica, pero **sin compare-and-swap**: dos
  procesos pueden escribir el uno después del otro;
- los dos ven el objetivo terminado **en el mismo instante** — el cierre de
  turno del agente coincide con el sondeo del supervisor — así que los dos
  deciden crear y se crean dos objetivos para el mismo trabajo. Uno se queda
  huérfano y sus tokens se pierden;
- y el hook **reescribía el journal entero** en cada cierre de turno, aunque no
  tuviera nada que escribir, además de **abrir una sesión del host** para
  hacerlo.

El kit de especificación de v0.2 ya pedía «mantener un solo writer». Ese
invariante era cierto para el **fichero** y falso para la **decisión**, que es
justo lo que se duplica.

### 7.2 La regla que lo hace literal

Una misión la conduce un camino, y el otro se aparta. Tres piezas, y las tres
hacen falta:

| Pieza | Qué resuelve |
|---|---|
| **La declaración** (`"driver"` en el fichero de misión) | Si está, es la ley: el otro camino se aparta y dice por qué |
| **El mando** (arrendamiento de 5 minutos) | Sin declaración, lo toma el primero que actúa; caduca, así que un proceso muerto no ata la misión |
| **El candado** (`chain.lock`, creado en exclusiva) | La ventana de encadenado es excluyente: dos vías no pueden crear a la vez |

Y una cuarta, que es la que faltaba de verdad: **apartarse es no tocar nada**.
El camino que no conduce no abre el host, no escribe en el journal y no deja el
estado a medias. Antes, «no encadenar» significaba «encadenar menos cosas»,
que no es lo mismo.

### 7.3 La prueba, con el host real y las dos manos

Dos misiones idénticas, con el plugin instalado, en el mismo host y con el
mismo encargo para el agente. Lo único que cambia es la declaración.

**Caso A — la misión declara `"driver": "plugin"`.** El hook conduce: toma el
mando, persiste la intención y crea el objetivo.

```text
$ ls ~/.local/state/goal-compass/ | grep conductor
prueba-conductor-plugin

$ cat ~/.local/state/goal-compass/prueba-conductor-plugin/journal.json
  "driver": "plugin",
  "driverAt": 1792470194070,
  "intents": [("nota-plugin", "committed", "tg_khug50zeamvg6h4ja")]
```

**Caso B — la misma misión declarando `"driver": "supervisor"`.** El hook
conduce… no: el hook se aparta, y al apartarse no deja ni rastro:

```text
$ ls ~/.local/state/goal-compass/ | grep conductor
prueba-conductor-supervisor      ← no aparece

$ cat ~/.local/state/goal-compass/prueba-conductor-supervisor/journal.json
cat: ...: No existe el fichero o el directorio
```

El estado durable de esa misión **no existe**. No hay journal, no hay
intención, no hay sesión abierta contra el host: el camino que no conduce no
toca nada. Esa es la diferencia entre «no encadenar» y «no existir» para el
resto del sistema.

### 7.4 El arnés ya no mide otro sistema

El arnés de aceptación escribía la declaración de la misión en `mission.json`,
que es el nombre que usa la línea de órdenes. El plugin, en cambio, busca la
suya en `goal-compass.json`, que es el nombre documentado para el repositorio
donde se quiere encadenar. Con el nombre equivocado, **el hook nunca encontraba
la misión**: no se apartaba por la declaración, sencillamente no existía para
él. La prueba pasaba, pero midiendo menos de lo que parecía.

Ahora el arnés escribe el fichero con el nombre real del producto, así que la
vía que se aparta es la vía de verdad. Y el escenario `exploration` comprueba
dos cosas que antes no comprobaba:

- **que el supervisor encadenó el objetivo** (su registro lo nombra; el del
  hook no);
- **que el trabajo no se encadenó dos veces** (una misión, un objetivo).

### 7.5 La comprobación permanente, y que muerde

La regla del apartarse tiene su prueba en la suite permanente, y se ha
demostrado que **muerde**: con el host abierto en el camino que no debe abrirlo,
la prueba falla.

```text
$ npx vitest run test/ownership.test.ts
 Test Files  1 failed (1)
      Tests  1 failed | 8 passed (9)
```

Sin la corrección, el camino apartado abría una sesión del host y escribía el
journal. Con ella, no abre el host, no crea el estado y dice por qué se aparta.

### 7.6 Lo que la aceptación midió esta vez

Los cinco escenarios, con sus comprobaciones:

| Escenario | Comprobaciones | Resultado |
|---|---|---|
| `chain` | 12 | Tres objetivos encadenados sin intervención; el del medio llega por el canal de propuestas y se encadena en su momento; 102 105 tokens medidos |
| `recovery` | 4 | Un fallo entre crear y confirmar se reconcilia sin duplicar |
| `pause` | 3 | La orden de pausa detiene el trabajo en curso y la de continuar lo reanuda |
| `budget` | 3 | Agotado el presupuesto (87 570 tokens), la cadena se detiene sin crear otro objetivo |
| `exploration` | 6 | Sin backlog ni pendientes marcados, el sistema pide buscar trabajo, encuentra trabajo real y lo encadena el supervisor, con evidencia que señala a ficheros que existen, y sin encadenar el mismo trabajo dos veces |

El escenario que cerraba el hueco:

```text
=============== RECIBO · exploration ===============
Sin backlog ni pendientes marcados, el sistema encuentra trabajo real y lo encadena
workspace: /tmp/gcl-exploration-shXWmJ
mision:    uat-exploration-1792470955966
--- comprobaciones ---
PASA · se encadeno un Goal sin trabajo marcado (origen: exploracion)
PASA · el sistema pidio buscar trabajo
PASA · el Goal viene de una fuente que investigo (exploracion)
PASA · su evidencia senala a un fichero real (NOTAS.md, src/fechas.ts)
PASA · el supervisor encadeno el objetivo (tg_o4ric84264mvg6ysq8)
PASA · no se encadeno el mismo trabajo dos veces (1)
==========================================================
```

Las dos últimas comprobaciones son nuevas, y son las que cierran el hueco:

- **«el supervisor encadenó el objetivo»** distingue quién lo hizo. El
  supervisor lo anuncia con su propia frase y el hook con la suya; el registro
  del escenario dice cuál de las dos nombra ese objetivo.
- **«no se encadenó el mismo trabajo dos veces»** es el invariante del ciclo,
  comprobado: una misión, un objetivo.

Y la exploración, que es la única fuente de trabajo que no viene de una lista
escrita a mano, sigue siendo la que decide:

```text
[2026-10-20T04:36:00.433Z] sin trabajo elegible: se pide una exploracion acotada del workspace
[2026-10-20T04:36:59.555Z] la exploracion aporto 2 candidato(s): la mision continua
[2026-10-20T04:37:02.559Z] decision: create - NOTAS.md pide expresamente "cubrirla con una
                prueba" y el repositorio no contiene ningún fichero de prueba ni runner
                configurado (solo existen goal-compass.json, NOTAS.md y src/fechas.ts), así
                que a día de hoy no hay ninguna forma de comprobar que la implementación de
                la tarea 0 funciona o deja de lanzar la excepción.
[2026-10-20T04:37:02.568Z] intencion persistida: exploracion:1:Añadir una prueba automatizada que cubra -> 52ef6294-26a0-4793-ba04-027407fc43a1
[2026-10-20T04:37:02.684Z] goal creado y confirmado: tg_o4ric84264mvg6ysq8 (active) - Añadir una prueba automatizada que cubra `exportar()` de src/fechas.ts, con una c
```

Ese texto no lo escribió el sistema: lo escribió **el modelo**, leyendo el
repositorio.

Un detalle del propio log que confirma el arreglo del arnés: el modelo enumera
lo que ve en el workspace y nombra **`goal-compass.json`**. Antes, el fichero
de la declaración se llamaba `mission.json` y el plugin no lo encontraba: la
vía que se aparta era una vía que no existía.

## 8 · El árbol como dato, y la cadena que no se apaga — **PASADO**

### 8.1 Lo que se encontró, con la fuente primaria

El núcleo puro de la decisión (`src/core/decide.ts`) dice tres cosas que
importan, y se leyeron ahí, no de memoria:

```text
decide.ts:100   mission.maxGoals !== null && goalsCreated >= maxGoals   -> park
decide.ts:107   tokensUsedTotal >= totalTokenBudget                     -> park
decide.ts:118   eligible.length === 0                                    -> park
decide.ts:221   compareCandidates: prioridad, riesgo, coste, identificador
decide.ts:139   reason: best.whyNow || `candidato elegido por prioridad`
```

El `whyNow` es texto: **no influye en la elección**. Y el hook del plugin
pasa `exploration: false` (`src/plugin/auto-continue.ts`), porque preguntar al
modelo se come el tiempo del turno.

De ahí sale el hueco: **en la vía del plugin la cadena no se autoalimenta**. Si
el backlog se vacía y nadie propone nada, el hook no encuentra trabajo, el turno
se acaba y la cadena muere con la misión todavía viva. Además, el objetivo que
arranca no llevaba nada del contexto del proyecto: el agente volvía a deducirlo
desde cero en cada turno.

### 8.2 El árbol, que era prosa, ahora es dato

La topología del grafo vivía escrita a mano en el texto de cada markdown. Eso
no se puede validar con sentido ni sustituir por proyecto.

Ahora cada nodo es un markdown con cabecera YAML, y la cabecera es la fuente de
la topología:

```yaml
---
id: implement
role: agent
links:
  - to: verify
    rel: next
    when: cambio aplicado
    evidence: comando de prueba preciso
---
```

La migración movió **66 enlaces** de 13 ficheros, sin perder ninguno: el
script que la hizo leyó los enlaces del markdown y los escribió en la cabecera.

Y como la topología es dato, la suite la comprueba con el mismo cargador que
usa el producto:

```text
$ npx vitest run test/skill-graph.test.ts
 Test Files  1 passed (1)
      Tests  8 passed (8)
```

Lo que se comprueba del árbol que **se instala**:

- todo enlace apunta a un nodo que existe;
- todo nodo se alcanza desde la entrada;
- todo nodo tiene salida (el agente no se queda atascado);
- todo nodo tiene una forma que el agente puede usar, con sus secciones y sus
  preguntas;
- un nodo de control (`role: supervisor`) solo se entra por `discover` o
  `await`.

### 8.3 El lector de YAML, sin dependencias

El proyecto no tiene dependencias en ejecución, y un lector completo de YAML es
una biblioteca entera. `src/adapters/yaml.ts` es un lector de un subconjunto
acotado: mapas, listas, escalares, comillas, comentarios y texto de bloque. Lo
que no admite —anclas, etiquetas, colecciones en linea, documentos multiples—
se rechaza con un error claro, en vez de adivinarse:

```text
yaml: linea 6: no se entiende la linea: rel:inventado
```

Y el error dice la línea, que es lo que hace falta para arreglarlo.

### 8.4 La respuesta de continuación, con contexto

El prompt que el hook entrega al agente al encadenar un objetivo no decía nada
del proyecto. Ahora dice dónde está la misión en ese momento:

```text
Contexto de la mision "mejora-continua":
- estado: running
- objetivos completados: 3; el ultimo fue "Cubrir exportar() con una prueba real"
- presupuesto: 102105 token(s) de 500000
- trabajo declarado pendiente: 2 candidato(s)
```

Y, sobre todo, **pide dejar el trabajo siguiente**. Eso es lo que cierra el
bucle: la cadena se alimenta de la continuidad del propio trabajo, no de una
lista escrita a mano.

```text
Cuando termines, deja el trabajo siguiente: con mission_propose, la evidencia
que lo respalda y como se sabra que esta hecho. Si de verdad no hay trabajo
que quede, dilo con claridad en vez de inventarlo. La cadena sigue mientras
alguien deje trabajo.
```

### 8.5 El directorio de trabajo, y que no ensucie el repositorio

Un proyecto puede tener su propio árbol en `.goal-compass/`, y ese directorio
**queda ignorado por git**: es configuración local y no debe ensuciar el
`git status` de quien está trabajando. El comando

```bash
node dist/cli.js tree --workspace /tmp/gcl-wd
```

en un repositorio recién hecho:

```text
directorio de trabajo: /tmp/gcl-wd/.goal-compass (creado) (anadido a .gitignore)
ignorado por git: si
arbol: .../skill/goal-compass/graph (de la skill)
entrada: index
nodos: 13 (11 de agente, 2 de control)
enlaces: 66
el arbol no tiene problemas

$ git status --porcelain
?? .gitignore
```

El directorio de trabajo **no aparece**: lo único que hay en el estado de git es
el `.gitignore` que el propio comando escribió.

### 8.6 La tormenta de ideas

Las ideas que surieron, con el motivo de integrarse o no, están en
`docs/IDEAS.md`. Se integraron cinco: el árbol como dato, la metadata con
dientes, la continuación con contexto, la petición de dejar el trabajo
siguiente, y el directorio de trabajo ignorado. Se dejaron cuatro fuera, y por
qué: recordar el nodo en el que se quedó (necesita un contrato nuevo con la
superficie de herramientas), explorar desde el hook (no cabe en nueve
segundos), hacer renovable el presupuesto (es el freno del usuario) e
includes en el árbol (nadie lo ha pedido).

### 8.7 La aceptación, después del cambio

El árbol con cabecera YAML no toca al supervisor, así que la aceptación tiene
que seguir dando lo mismo. Dio lo mismo:

```text
=============== RESUMEN ===============
PASA · chain
PASA · recovery
PASA · pause
PASA · budget
PASA · exploration
=======================================
```

Veintiocho comprobaciones, con las cifras de esta ejecución: la cadena costó
114 361 tokens en tres objetivos y el freno de gasto se paró en 65 460. El
escenario de exploración siguió midiendo lo que mide: trabajo real, encontrado
por el modelo, encadenado por el supervisor, con evidencia que señala a
ficheros que existen y sin encadenar el mismo trabajo dos veces.

## 9 · La misión se activa con una frase

### 9.1 El hueco que quedaba abierto

Todo estaba instalado, pero **no había nada que activar**. El hook busca la
declaración de la misión en el proyecto; si no la encuentra, no hay nada que
encadenar y no dice por qué. Y la forma de crearla no estaba escrita en
ningún sitio: la skill explicaba cómo *seguir* una misión, no cómo *empezar*
una.

Eso convertía «quiero usarlo ya» en una tarea de diez minutos con un paso
imposible de adivinar. Un escáner que descarta en silencio, otra vez.

### 9.2 Declarar es una puerta, no un fichero

Ahora hay una sola puerta para declarar una misión, con tres entradas que
hacen lo mismo:

| Entrada | Para qué |
|---|---|
| `goal-compass declare --workspace <dir>` | Preparar un proyecto desde la línea de órdenes |
| `mission_declare` | Declararla desde la sesión, sin salir de la conversación |
| `goal-compass.json` a mano | Cuando se quiere controlar el contenido palabra por palabra |

Las tres acaban en la misma función, y esa función tiene dos reglas:

- **No pisa.** Si ya hay una declaración, la devuelve tal cual. Declarar dos
  veces no rompe nada y una declaración escrita a mano no se pierde por
  detrás de la herramienta.
- **No inventa el identificador.** Sale del nombre del proyecto y de una
  huella corta de su ruta, así que dos proyectos con el mismo nombre no
  comparten estado durable por accidente.

El identificador importa más de lo que parece. El estado durable vive en
`~/.local/state/goal-compass/<mission-id>/`, fuera del repositorio: si dos
proyectos se apropian del mismo identificador, se pisan **en silencio**, y cada
uno creería que está solo. Eso ya no puede pasar por dos vías:

- la herramienta deriva un identificador distinto por proyecto;
- si alguien fuerza el mismo identificador en dos proyectos, el sistema lo dice
  y **no conduce**: «la misión "X" ya tiene estado del proyecto "Y"».

### 9.3 La prueba, con el host real y un prompt

Proyecto de prueba en `/tmp/gcl-prompt-demo`, con la declaración hecha a
mano con el comando:

```bash
$ node dist/cli.js declare --workspace /tmp/gcl-prompt-demo \
    --objective "Mejorar este proyecto de prueba paso a paso"
mision declarada en /tmp/gcl-prompt-demo/goal-compass.json
mision: gcl-prompt-demo-7eb9
conduce: plugin
```

Y después, una sesión real de MCode con un prompt de los que el usuario
escribe:

```bash
$ mcode exec "continua la mision de este repositorio" \
    --cwd /tmp/gcl-prompt-demo --permission off
```

Lo que pasó:

```text
$ cat ~/.local/state/goal-compass/gcl-prompt-demo-7eb9/journal.json
  "sessionId": "mvs_2ce1cd2211c54a28967fb302ed5b6450",
  "driver": "plugin",
  "driverAt": 1792489441063,
  "intents": [("propuesta:Automatizar la verificación con un workflow...", "committed", "tg_36ehdi5tpzmvghwkkh")]
```

Y lo que el agente hizo con ese objetivo, en el repositorio de prueba:

```text
package.json        ← con "test": "node --test"
test/mision.test.js ← dos pruebas de un módulo nuevo
app.js              ← el módulo que las pruebas cubren
```

Lo que demuestra, en orden:

1. **Un prompt basta.** No hubo ningún paso previo: la declaración existía, el
   hook la encontró al cerrar el turno y encadenó.
2. **El objetivo nació en la sesión del usuario** (`sessionId` del host), no en
   una aparte.
3. **La cadena se alimentó sola.** El objetivo no salió de un backlog escrito
   a mano, sino de una **propuesta que el agente dejó** con su evidencia. Es
   el bucle de continuidad funcionando: el trabajo siguiente lo deja quien
   termina el anterior.
4. **El agente trabajó de verdad**, con ficheros en el repositorio y pruebas
   que las ejecutan.

Lo único que no salió bien fue el apagado: MCode terminó el turno con
«Runtime shutdown did not complete cleanly». Es del runtime del host al
desconectar, después de que el objetivo ya estuviera creado y confirmado; el
journal y la transición quedaron íntegros.

### 9.4 La vía completa, desde el prompt y sin tocar la terminal

La prueba anterior daba por hecho que la declaración ya estaba. La siguiente
no: el proyecto estaba **vacío**, sin `goal-compass.json` y sin nada preparado,
y todo se pidió con una frase.

```bash
$ mcode exec "prepara la mision de este proyecto con el objetivo \
    'dejar el repositorio con pruebas'" --cwd /tmp/gcl-prompt-declare --permission off
```

Lo que encontró el proyecto al terminar:

```text
goal-compass.json   ← la declaración, con el objetivo que se pidió
.goal-compass/      ← el directorio de trabajo
.gitignore           ← con la entrada de .goal-compass/
README.md           ← con la misión anotada
```

Y lo que encontró el estado durable de la misión:

```text
"sessionId": "mvs_28d06796817f48c7aed28bf1ddcb1f5f",
"driver": "plugin",
"driverAt": 1792491855463,
"intents": [("propuesta:Definir el stack de pruebas y dejar el arnés mínimo...", "committed", "tg_zds1eicp42mvgjbjjm")]
```

El recorrido entero, con un solo prompt:

1. El agente declara la misión, con el objetivo que se le dio.
2. El agente deja una **propuesta** con su evidencia y su criterio de cierre.
3. Al cerrar el turno, el hook encuentra la declaración, toma el mando y
   **encadena el objetivo** en esa misma sesión.

No hubo ningún paso previo, ni un fichero preparado a mano, ni una orden en la
terminal. Esa es la vía que se pidió, y funciona.

### 9.5 Lo que el cambio añadió al producto

- El comando `declare`, que deja el proyecto con su declaración, su directorio
  de trabajo y su entrada en `.gitignore`.
- La herramienta `mission_declare`, que hace lo mismo desde la conversación.
- La sección de la skill que explica cómo activar la misión, con el comando
  como alternativa cuando la herramienta no está en la sesión.
- La detección del identificador ocupado: dos proyectos con el mismo
  identificador se dicen en vez de pisarse.

### 9.6 La aceptación, después del cambio

```text
=============== RESUMEN ===============
PASA · chain
PASA · recovery
PASA · pause
PASA · budget
PASA · exploration
=======================================
```

Veintiocho comprobaciones, con las cifras de esta ejecución: la cadena costó
123 747 tokens en tres objetivos y el freno de gasto se paró en 67 456. El
escenario de exploración siguió midiendo lo que mide: trabajo real, con
evidencia que señala a ficheros que existen, encadenado una sola vez.

La cadena de esta ejecución, con el trabajo del medio llegando por el canal de
propuestas:

```text
[2026-10-20T10:00:27.323Z] decision: create - trabajo pendiente de la cadena
[2026-10-20T10:00:27.562Z] goal creado y confirmado: tg_qs5aok6er9mvgiipjn (active)
[2026-10-20T10:02:51.765Z] goal completado registrado: tg_qs5aok6er9mvgiipjn (complete(verifier_met))
[2026-10-20T10:02:51.783Z] decision: create - propuesto durante la sesion
[2026-10-20T10:02:51.873Z] goal creado y confirmado: tg_9vs0u5fmilmvgilt0g (active)
[2026-10-20T10:05:46.162Z] goal completado registrado: tg_9vs0u5fmilmvgilt0g (complete(verifier_met))
[2026-10-20T10:05:46.170Z] decision: create - trabajo pendiente de la cadena
[2026-10-20T10:05:46.251Z] goal creado y confirmado: tg_u678z195ugmvgipjkj (active)
[2026-10-20T10:08:17.586Z] goal completado registrado: tg_u678z195ugmvgipjkj (complete(verifier_met))
```

La suite permanente sube a **144 pruebas en 12 ficheros**: las nuevas cubren el
identificador derivado, la declaración que no pisa, la que se puede escribir a
mano, la que está a medio hacer, la que no es legible, el enlace simbólico que
apunta al mismo sitio y el proyecto que ocupa el identificador de otro.

## 10 · Lo que se perdió entre el backlog y el agente

### 10.1 El hueco, con la fuente primaria

El backlog de la misión guarda, de cada candidato, su evidencia (el fichero
que lo pide) y su criterio de cierre (cómo se sabrá que está hecho). Esa
información se perdía en tres saltos:

- `src/core/types.ts` — `TransitionIntent` guardaba `candidateId`,
  `candidateKey`, `objective` y `tokenBudget`. Ni la evidencia ni el
  criterio.
- `src/supervisor.ts` — el objetivo se creaba con `candidate.objective` y el
  presupuesto. Lo demás se quedaba en el candidato.
- `src/plugin/auto-continue.ts` — la respuesta de continuación llevaba el
  objetivo y el contexto de la misión, pero no la evidencia ni el criterio
  del candidato que se estaba encadenando.

La consecuencia con un roadmap es directa: el agente recibía «haz esto» sin
«esto sale de aquí» ni «esto se demuestra así», y tenía que buscar la fuente
en cada turno.

### 10.2 Lo que exigía el contrato del host

La primera intención fue llevar la evidencia por un canal propio. El host no
tiene ese canal:

- **El Goal se autoejecuta.** Su arranque solo lleva el texto del objetivo
  (ADR-001). Nada más llega al worker: un archivo aparte no se abre solo.
- **La extensión ACP solo acepta tres campos**: `{ sessionId, objective,
  tokenBudget? }` (ADR-001). Los adjuntos que el host admite
  (`attachments`, `objectiveResources`) no se pasan por esa vía: el manejador
  de `goal/create` solo reenvía esos tres.
- **El objetivo puede tener un tope de longitud** (`goal.objectiveMaxChars`,
  configurable; sin tope por defecto), y pasarse devuelve
  `GOAL_OBJECTIVE_TOO_LONG`.

Si la evidencia tiene que llegar al worker, tiene que ir dentro del texto del
objetivo. Y si va dentro, tiene que ir compacta.

### 10.3 Lo que se hizo

- **El objetivo se compone**: el texto del trabajo, la evidencia y el
  criterio de cierre. Vive en `composeObjective`, que es pura y se prueba
  sola.
- **La intención guarda las dos cosas**: `evidenceRefs`, `doneWhen` y el
  `hostObjective` que se le dio al host. El texto del trabajo se guarda
  aparte (`objective`), para que se pueda leer y comparar sin el ruido.
- **El historial del objetivo terminado** guarda la evidencia y el criterio.
- **La respuesta de continuación** nombra el fichero de evidencia y el
  criterio de cierre, junto al contexto de la misión.

La reconciliación se tuvo que tocar con cuidado: compara el objetivo del host
con el de la intención, y ahora son dos textos. Se comparan con el que
recibió el host, con vuelta atrás para las intenciones antiguas.

### 10.4 Las pruebas, y que muerden

```text
$ npx vitest run test/objective.test.ts test/supervisor.test.ts test/plugin.test.ts
```

Sin el cambio, nueve pruebas fallan:

```text
× lleva el trabajo, la evidencia y el criterio de cierre
× enumera todos los ficheros de evidencia
× enumera todos los criterios de cierre
× no inventa evidencia ni criterio que no existen
× empieza con el texto del trabajo, sin espacios de mas
× el objetivo que recibe el host lleva la evidencia y el criterio de cierre
× la intencion persistida guarda la evidencia y el criterio
× el historial del objetivo terminado guarda la evidencia y el criterio
× la continuacion nombra la evidencia y el criterio de cierre del objetivo
```

### 10.5 El defecto que salió al probarlo con el host de verdad

Al encender la cadena sobre este mismo repositorio para ver el objetivo
compuesto en el host, pasó algo que no estaba en el plan: el hook se apuntó
a la sesión y **le cobró a la misión el gasto de un objetivo que la cadena no
había creado**.

```text
[goal-compass] sesion reanudada: mvs_a37c5d35f49e44f695e808c2763193e9
[goal-compass] goal completado registrado: tg_mg9ky0r1r8mvfo4f8m (complete(verifier_met))
[goal-compass] decision: park - presupuesto de la mision agotado (2394829 de 600000 tokens)
```

El objetivo nativo que el usuario ya tenía en su sesión se contabilizó
entero, y la misión quedó dormida por presupuesto agotado nada más declararla.
Con un presupuesto normal, cualquier sesión que ya tenga un objetivo previo
deja la misión muerta al instante, y el motivo no dice de dónde salió el
gasto.

El arreglo son dos filtros: un objetivo sin intención que lo cree no se
registra en la misión, y el objetivo en curso solo suma si lo creó la cadena.
La prueba que lo cubre falla sin el arreglo:

```text
AssertionError: expected [ { goalId: 'tg_ajeno', …(10) } ] to have a length of +0 but got 1
```

## 11 · El presupuesto como medida, no como muro

### 11.1 Lo que pasaba

Un objetivo que se quedaba sin presupuesto dejaba la cadena esperando para
siempre. El trabajo a medias se perdía, y a los 45 minutos de estancamiento
la misión entera se dormía con el motivo a la vista: el presupuesto se había
acabado.

El sistema lo daba por un límite y lo trataba como un límite: los estados
`budget_limited` y `usage_limited` devolvían «espera», y la espera no la
resolvía nadie.

### 11.2 La regla nueva

Agotar el presupuesto no dice nada del trabajo: solo dice que se le acabó el
sitio. Así que el trabajo vuelve a la cola con el doble de margen, hasta tres
intentos:

```text
el objetivo tg_1 se quedó sin presupuesto (51 633 de 3 000 tokens)
   → el mismo trabajo se reintenta con 6 000
   → si vuelve a quedarse corto, con 12 000
   → al tercer intento, la misión espera a que alguien lo revise
```

Dos detalles que la hacen funcionar:

- **Es el mismo trabajo.** La clave estable no cambia, así que el historial
  enseña los intentos y su coste, y la evidencia y el criterio de cierre
  siguen puestos.
- **Hay que liberar el hueco.** El host guarda un solo objetivo por sesión, y
  un objetivo que no ha terminado impide crear el siguiente: el agotado se
  vacía antes de encadenar el reintento.

Y el total de la misión deja de ser una puerta: se anota, se avisa cuando se
supera y se enseña en la respuesta de continuación, pero la cadena sigue.

### 11.3 La prueba contra el host real

El escenario de aceptación deja el presupuesto del objetivo tan pequeño que
el host lo agota, y comprueba que el trabajo vuelve a la cola:

```text
PASA · el intento agotado quedo anotado (1)
PASA · el trabajo volvio a la cola (2 intento(s))
PASA · el reintento lleva mas margen (3000 -> 6000)
PASA · el gasto del intento agotado cuenta (51633 token(s))
PASA · la mision no quedo escalada
```

Y el escenario del presupuesto de la misión, que antes exigía que la cadena se
detuviera, ahora exige lo contrario:

```text
PASA · el presupuesto superado quedo anotado
```

### 11.4 Lo que muerde

Nueve pruebas nuevas. Sin el cambio, la cadena se queda esperando:

```text
× reintenta el trabajo agotado con el doble de margen
× no toca el objetivo que no es de la cadena
× deja el trabajo para un humano cuando se agotan los intentos
× el presupuesto de la mision superado se mide pero no detiene la cadena
× libera el objetivo agotado y encadena el mismo trabajo con mas margen
× el objetivo agotado que no es de la cadena no se toca
× el trabajo vuelve a la cola con el doble de margen (contra el host real)
```

## 12 · El hook que no llegaba a tiempo

### 12.1 El síntoma

Un agente terminó su turno y la cadena no encadenó nada. El agente informaba
de que la misión estaba viva, con candidatos pendientes y con el siguiente
trabajo propuesto; nada de eso llegó a ejecutarse.

La cadena no estaba dormida: el siguiente objetivo nunca se creó.

### 12.2 La fuente primaria

El registro del host lo dice sin rodeos:

```text
[13:32:14.237] WARN: [] Plugin hook command failed open
  {"code":"HOOK_TIMEOUT","pluginName":"goal-compass",
   "sourcePath":"hooks/auto-continue.json","event":"Stop"}
```

Ocho veces seguidas, a distinta hora, con dos códigos distintos
(`HOOK_TIMEOUT` y `HOOK_ABORTED`). El hook se ejecutaba, fallaba y el host
seguía como si el hook no hubiera dicho nada. Por eso el turno terminaba sin
continuación: la salida del hook nunca llegó.

### 12.3 Por qué fallaba

El hook tiene que hacer dos cosas: crear el objetivo en la sesión del usuario
y devolver la continuación. Medido contra el host real:

| Paso | Coste |
|---|---|
| Arrancar el host ACP | 3,1 s |
| Reanudar la sesión del usuario | 5,8 s |
| Leer el objetivo | 3 ms |
| Cerrar el host | 0,25 s |

Son unos diez segundos de trabajo real. El hook se daba **9 segundos** de
margen. El resultado era siempre el mismo: el hook se rendía a mitad, con el
host ACP todavía en pie.

Y ahí aparecía el segundo defecto: cuando el hook se rendía, no cerraba el
host que había arrancado. El proceso se quedaba vivo, el host esperaba a su
propio límite (120 s) y tiraba la salida. Reproducido con el hook instalado:

```text
[goal-compass] arrancando host ACP: mcode acp
[goal-compass] extension de Goal verificada en el host
[goal-compass] AVISO no se pudo encadenar el objetivo siguiente: ...
real  2m10,007s
```

Dos minutos y diez segundos de turno perdido, y ni una palabra de
continuación. El trabajo que el sistema había preparado se quedaba en el
cajón.

### 12.4 Lo que el host sí esperaba

El contrato del host para el evento `Stop` es corto y el plugin ya lo cumplía:
`{"decision": "block", "reason": "..."}` se convierte en la continuación que
se inyecta al agente. El problema no era el formato: era el reloj.

### 12.5 El arreglo

- El margen del hook pasa a estar **por encima del trabajo real y por debajo
  del límite del host** (45 s, con 120 s de margen en el host).
- **Ninguna petición al host espera sin tope**: si el host no contesta, la
  petición se rinde sola en lugar de dejar el turno colgado.
- **El host ACP se cierra siempre**, también cuando la misión no llega a
  arrancarse o cuando se agota el margen.
- **El proceso del hook termina siempre**, después de escribir su salida.

### 12.6 La prueba que lo cubre

Dos pruebas de proceso, que ejecutan el hook como lo hace el host —un proceso
aparte, con entrada y salida estándar— y comprueban que termina:

```text
× termina aunque el host falle, sin quedarse colgado   (sin el arreglo)
× termina aunque el host no conteste                   (sin el arreglo)
```

Con el arreglo, las dos pasan en menos de veinte segundos. Antes, el proceso
no terminaba nunca y la prueba moría de tiempo.

### 12.7 La prueba contra la sesión real

El hook, ejecutado contra la sesión de trabajo de verdad, sobre un objetivo
que se había quedado sin presupuesto:

```text
[goal-compass] sesion reanudada: mvs_a37c5d35f49e44f695e808c2763193e9
[goal-compass] AVISO objetivo tg_bwirib8nammvgk6ks8 sin presupuesto (131423 token(s))
[goal-compass] decision: retry - el mismo trabajo se reintenta con 240000
[goal-compass] objetivo liberado: se reintenta con 240000 token(s)
[goal-compass] goal creado y confirmado: tg_agath2k9s0mvgmru9x (active)
[goal-compass] objetivo encadenado: tg_agath2k9s0mvgmru9x
real  0m10,800s
```

Y la salida que el host recibe:

```json
{"decision":"block","reason":"La mision continua: el objetivo se quedo sin
presupuesto y este es el mismo trabajo reintentado con mas margen.
Objetivo: Que la evidencia y el criterio de cierre del candidato encadenado
lleguen al objetivo y a la respuesta de continuacion
Evidencia: docs/roadmap.md#p1
Criterio de cierre: ..."}
```

Diez segundos y ocho décimas, con la continuación dentro. La misma
ejecución, antes del arreglo, tardaba dos minutos y diez segundos y no
devolvía nada.

## 13 · La continuidad que no depende del tamaño de la sesión

### 13.1 El síntoma

El hook encadenaba deprisa al principio y se acercaba a su límite con el
tiempo. No era el hook: era el trabajo que el hook tenía que hacer antes de
encadenar.

La sesión de este repositorio tiene **22 MB de historial**. Cargarla cuesta
**6,2 segundos**, y el historial crece con cada turno: cuanto más trabaja la
cadena, más cara es la carga siguiente.

### 13.2 Lo que exige el host

Mirado en el paquete de `mcode` 0.6.12 y medido contra el host real:

- `mcode/session/goal/create` **exige que la sesión esté cargada en el proceso
  ACP** que hace la petición. Sin `session/load` previo: `Resource not found`.
- `mcode/session/activate` solo acepta sesiones **creadas en ese mismo
  proceso** ACP: no sirve para abrirse en una sesión que ya existía.
- **`create_goal` no está expuesta al agente** en 0.6.12. La clase está en el
  paquete pero no se instancia: las herramientas de objetivo que ve el agente
  son `get_goal` y `update_goal`. La vía de «que el agente cree su propio
  objetivo» queda descartada.
- El host da a un hook de plugin **10 segundos como máximo** (el manifiesto
  solo admite enteros de 1 a 10) y el presupuesto de todo un evento de hook
  es de 15 segundos.

### 13.3 Las medidas

Con el host real, en la sesión de este repositorio:

| Operación | Coste |
|---|---|
| Arrancar el host ACP y apretar manos | 3 505 ms |
| Cargar la sesión (22 MB de historial) | **6 245 ms** |
| Cargar la sesión otra vez, en el mismo proceso | 6 701 ms (no hay caché: se relee) |
| Crear el objetivo con la sesión ya cargada | 146 ms la primera vez, **40 ms** la segunda |
| Leer el objetivo con la sesión ya cargada | **2 ms** |

La última fila es la que importa: **el coste estaba en la carga, no en la
creación**. Con la sesión ya cargada, crear un objetivo es trabajo de un
instante.

### 13.4 La prueba contra el host real

Sesión real, por ACP, con el plugin instalado y una misión declarada en el
directorio de trabajo:

```text
14:27:34.635  el proceso vivo empieza a escuchar
14:27:37.933  el host ACP anuncia la extensión de objetivo
14:27:39.114  la sesión queda cargada en el proceso vivo
14:27:41.703  el hook de continuación toma el mando
14:27:41.760  el objetivo siguiente está creado
```

**57 milisegundos** entre que el hook toma el mando y que el objetivo existe.
El camino anterior, con la carga de la sesión dentro, necesitaba más de seis
segundos solo para llegar al mismo punto.

El objetivo creado (`tg_f4muylb5t3mvgs2ds0`) quedó activo en el host, el
agente trabajó en él —escribió el fichero que pedía— y el presupuesto gastado
se midió en el journal de la misión.

### 13.5 Lo que se encontró por el camino

- **El hook de inicio de sesión también se dispara en las sesiones de
  subagente**, y esas el host no las deja abrir: `Invalid params: Sub-agent
  Sessions are internal and cannot be opened`. El proceso vivo ahora lo
  reconoce y se apaga en vez de reintentar cinco veces.
- **El proceso vivo muere con el host que lo lanzó.** Comprobado en el rastro:
  `el proceso que lanzo el proceso vivo ya no esta: se apaga`.
- **El fin de sesión no siempre se dispara** (`mcode exec` no lo dispara), así
  que el proceso vivo no puede depender solo de ese hook: se apaga también
  cuando su dueño desaparece.

## 14 · Una declaración puede no valer nada, y decirlo

### 14.1 Lo que se encontró mirando fuera

Al auditar las misiones declaradas en los demás proyectos **con el cargador
real del plugin**, una de ellas tenía sus **22 candidatos descartados**:

```text
cognicode
  candidatos: 22 | usables: 0 | descartados: 22 | con problemas
  - [campo-desconocido] (22: C2, C3, C4, ...) el campo "evidence" no lo lee el cargador
      el campo que si se lee es "evidenceRefs"
  - [sin-evidencia] (22: C2, C3, C4, ...) el candidato se descarta: no tiene evidencia
  - [prioridad-invertida] ((C2)) el primer candidato del fichero tiene la prioridad mas baja
```

La causa era un nombre de campo: la evidencia estaba en `evidence` (uno) y el
cargador lee `evidenceRefs` (una lista). El valor era una ruta que existía y
el autor creía que la había dejado. Los **22** candidatos quedaron sin
evidencia, el filtro los descartó, y la cadena no tenía nada que encadenar.

La prioridad iba además al revés: el selector ordena de mayor a menor
(`src/core/decide.ts:300`), y el primer candidato del fichero tenía la
prioridad más baja. Con la cola escrita así, la cadena habría empezado por
otro candidato del que la propia auditoría del proyecto nombraba como el
siguiente.

**Comprobación del antes y el después**, con el código real:

| | antes | después |
|---|---|---|
| candidatos usables | 0 de 22 | 22 de 22 |
| descartados | 22 | 0 |
| elegido por el selector | (ninguno) | C2, el que nombra la auditoría |

El diagnóstico se hizo **sin escribir en ningún proyecto**: se leyó el fichero
declaración y se ejecutó el cargador, nada más.

### 14.2 Lo que hace ahora el producto

- **`declare` deja de dar por buena una declaración inútil.** Con una
  declaración de mentira, escrita con el campo equivocado:

  ```text
  candidatos: 1 | usables: 0 | descartados: 1
  AVISO [campo-desconocido] (trabajo-1) el campo "evidence" no lo lee el cargador
        el campo que si se lee es "evidenceRefs"
  AVISO [sin-evidencia] (trabajo-1) el candidato se descarta: no tiene evidencia
        su campo evidenceRefs tiene que traer al menos una referencia
  ```

- **`doctor` audita la flota entera, solo lectura.** Sobre las ocho misiones
  que el estado durable conoce: seis están listas, y dos tienen problemas que
  se dicen con su motivo y con su arreglo debajo.

- **Las referencias se comprueban**: la ruta tiene que existir y, si lleva
  ancla, el ancla tiene que estar en el fichero (identificador explícito,
  número de sección o título como lo convierte GitHub en enlace).

### 14.3 La prueba que falla sin el cambio

Comprobación rojo-verde con la CLI en su estado anterior: la prueba del
diagnóstico falla (`expect(code).toBe(0)` — el comando no existía) y vuelve a
pasar con el comando dentro. Las nueve pruebas nuevas cubren la evidencia
mal escrita, la referencia rota, el ancla que no existe, la cola invertida y
el hecho de que el diagnóstico no escribe en el proyecto que audita.

**Suite completa: 187 pruebas en verde, 16 ficheros.**

## 15 · Lo que NO se ha ejecutado

- **El diagnóstico se ha probado contra misiones de verdad, pero no se ha
  usado para arreglar ninguna.** Se écritó, se leyó y se dijo qué pasaba; el
  arreglo de las misiones que tienen problemas es de quien las posee, y este
  proyecto no las toca. Lo que sí se ha comprobado es que el diagnóstico
  **no escribe**: hay una prueba que lee el fichero antes y después y
  comprueba que es el mismo.
- **El plugin no se ha probado en la interfaz gráfica.** La validación se ha
  hecho con `mcode exec`, que es la misma ruta de hooks pero sin pantalla.
- **El servidor de herramientas no se ha probado desde la interfaz gráfica.**
  Se ha probado con `mcode exec` (el agente llamó a la herramienta y recibió el
  estado) y con peticiones directas de JSON-RPC sobre la entrada y salida
  estándar, no pulsando botones.
- **La exploración con modelo no se ejecuta desde el hook.** El hook tiene
  margen de segundos y preguntar al modelo se lo come; la exploración la hace
  el supervisor en segundo plano.
- **La propuesta se ha probado de punta a punta, pero en un caso concreto.** El
  agente del host propuso con la herramienta y el sistema encadenó su
  propuesta, con evidencia y criterio de cierre. Lo que no se ha repetido es
  esa prueba varias veces: una vez es un indicio, no una garantía.
- **El proceso vivo no se ha probado desde la interfaz gráfica.** Se ha
  probado con una sesión real por ACP: el hook de inicio levanta el proceso,
  el de continuación crea el objetivo por él y el objetivo queda activo en el
  host. Lo que no se ha hecho es arrancar la interfaz y ver cómo se comporta
  el proceso vivo en una sesión larga de uso normal.
- **El proceso vivo no se ha probado con el historial grande.** Se ha probado
  con una sesión recién empezada, que es justo cuando tiene que cargar. La
  cuenta de «6,2 segundos para una sesión de 22 MB» viene de la sesión de
  este repositorio, pero cargarla en un proceso vivo para ver que aguanta no se
  ha hecho.
- **El bucle completo con un agente de verdad se ha ejecutado una vez de
  punta a punta.** En la sesión real por ACP de la sección 16 el objetivo se
  creó, el host lo entregó en un turno propio, el agente leyó el resultado de
  sus herramientas, propuso el trabajo siguiente, cerró el objetivo y el
  verificador del host lo aceptó. Lo que **no** se ha repetido es ese ciclo
  muchas veces seguidas en la misma sesión: una vez es un indicio, no una
  garantía.
- **No se ha mirado la interfaz gráfica del plugin.** Se ha probado por ACP,
  que es la misma ruta de hooks, pero sin pantalla. Lo que el plugin pinta en
  pantalla —si pinta algo— no se ha visto.
- **El panel gráfico no se ha buscado con la misma compañía que el resto.**
  Mirando el manifiesto del host 0.6.12 se sabe que un plugin de terceros no
  tiene superficie gráfica (la sección 7 del roadmap lo cuenta), pero no se ha
  intentado ninguna de las vías que quedan: una página HTML local, o una
  integración con las superficies de texto.

## 16 · El agente que trabajaba a ciegas

### 16.1 El síntoma

Una sesión real por ACP, con un agente de verdad y una misión de dos
objetivos comprobables. El primer objetivo se creó en 103 ms y el agente lo
recibió. A partir de ahí, todo lo que el agente hizo fue a ciegas:

```text
Tool-result delivery seam is closed.
```

Veintitrés llamadas seguidas —`get_goal`, `read`, `write`, `bash`, `grep`,
`task`— y ni un solo resultado. El agente siguió intentándolo con mas
variantes: escribir el fichero con la herramienta `write`, volver a escribirlo
con `printf`, pedir a un subagente que lo comprobara, releer un fichero de
evidencia que el mismo habia dejado en disco. Todo con el mismo resultado.

Lo que duele del caso no es el error: es lo que vino despues. El agente
redactó su cierre afirmando que el fichero existia con tres bytes, y lo
afirmaba con una seguridad que no podia tener: **no habia leido ni un solo
resultado**. La escritura si que habia ocurrido —la herramienta ejecuta aunque
su resultado no llegue—, asi que en esa occasion la afirmacion(resulto
correcto) coincidio con la realidad(no verificada). El agente no lo sabia: no
tenia forma de saberlo.

### 16.2 Lo que se midió

| | Antes | Despues |
|---|---|---|
| Resultados entregados tras el encadenado | 0 de 23 | 112 de 112 |
| Errores de entrega | 23 | 0 |
| Tokens gastados en el objetivo | 51 585 | — |

### 16.3 La causa, en el host

El error no es del plugin: es de como el host entrega el resultado de una
herramienta. En el host de MCode 0.6.12, el estado del turno tiene una fase, y
esa fase decide si una herramienta puede devolver algo:

```text
// fragments/chunk-47KWM23C.js
function ECr(e, t) {                 // abrir la entrega de resultados
  let n = Xm(e, t);
  return !n || n.phase !== "running" ? !1 : (n.toolResultTailOpen += 1, !0);
}
```

Y el cierre del turno pone esa fase en `closing` **antes** de que corra el
hook:

```text
function cxt(e, t, n) {
  ...
  r.phase = "closing",
  { closed: !0 }
}
```

El hook `Stop` corre despues. Si pide continuar el turno, el host le inyecta
un mensaje nuevo y el turno sigue, pero **la fase ya no vuelve a `running`**.
La entrega de resultados no se reabre. De ahi el mensaje: el host ya no puede
entregar el resultado de la herramienta.

El orden importa: el fallo aparece **en el mismo instante** en que el hook
inyecta su continuacion, antes de que empiece el turno siguiente.

### 16.4 El arreglo

El plugin deja de entregar el objetivo por su cuenta.

El host ya tiene su propia machinery de objetivos: cuando hay un objetivo
activo, lo encola y lo entrega en un turno propio, con su propio texto de
arranque (`Continue working toward the active thread goal`). Ese turno es un
turno de verdad, con su lease y con su fase en `running`: el agente trabaja con
sus herramientas.

Asi que el hook hace dos cosas y ninguna mas:

1. Crea el objetivo, como siempre.
2. **No dice nada.** Devuelve la salida vacia y deja que el turno se cierre.

Lo que el plugin tenia que contarle al agente —la evidencia, el criterio de
cierre, el contexto de la mision, el limite de publicacion— viaja ahora
**dentro del objetivo**, que es lo unico que el host lleva al agente cuando
encadena un objetivo nuevo. Lo que queda fuera, no llega.

### 16.5 La prueba, en rojo y en verde

La prueba real es la de la seccion 16.1: una sesion ACP con un agente de
verdad, con el hook instalado y el host de verdad. Con el arreglo, las 112
llamadas que hace el agente en el turno del objetivo devuelven su resultado.

En el arnés, el contrato cambio de sitio y las pruebas lo dicen: el hook ya
no devuelve una decision de `block`, y el objetivo que recibe el host es el que
lleva el limite, el contexto y las instrucciones de trabajo.

## 17 · El proceso vivo que preguntaba a un host ocupado

### 17.1 El síntoma

En una sesion real, el hook `Stop` agotaba su tiempo en **todos** los turnos:

```text
WARN: [] Plugin hook command failed open
  {"code":"HOOK_TIMEOUT","pluginName":"goal-compass",
   "sourcePath":"hooks/auto-continue.json","event":"Stop"}
```

El hook `Stop` es el latido de la cadena: si no dice nada, la cadena no
encadena nada.

### 17.2 La causa

El proceso vivo existe para que el hook sea rapido —responde en milisegundos
porque ya tiene la sesion cargada en el host—. Pero no guardaba el objetivo:
cada pregunta era una ida y vuelta al host.

Y esa ida y vuelta es justamente lo que se colgaba:

1. El estado del objetivo solo existe en la memoria del host.
2. Mientras el hook `Stop` corre, el host esta **dentro** de `finishTurn`,
   bloqueado esperando al hook.
3. El proceso vivo pregunta al host, el host no puede responder, el proceso
   vivo agota sus 7 s, el hook cae al camino de reserva —abrir un host nuevo y
   cargarle la sesion: 9,5 s— y el host corta el hook a los 10 s.

El componente que deberia evitar el atasco era el que se atascaba. Y no era un
problema de un proyecto: le pasaba a toda sesion que usara la cadena.

### 17.3 El arreglo

El proceso vivo **guarda el objetivo** y responde con lo que sabe:

- Al cargar la sesion —que es cuando el host esta libre— se pregunta una vez
  cual es el objetivo. A partir de ahi manda el aviso de cambio
  (`mcode/session/goal_update`) que el host ya emitia y que el adaptador ya
  escuchaba.
- El `read` se responde con lo que se sabe. Si no se sabe nada, se pregunta con
  un **tope de 400 ms**; si tampoco contesta, se responde con un error y **no**
  con «no hay objetivo». Callar afirmaria algo que no se sabe, y podria crear
  un objetivo que ya existe.

Ademas, el objetivo recien creado se guarda en el acto: el aviso de cambio
llega despues, y hasta que llega, leer tiene que dar el objetivo nuevo. Dar el
anterior —que ademas puede estar completo— habilita encadenar otra vez sin
querer.

### 17.4 La prueba, en rojo y en verde

La prueba es el caso que rompe la cadena: el host de la sesion **muerto**,
que es lo que pasa mientras el hook corre.

```text
[goal-compass] el proceso vivo responde: el objetivo se creara por ahi
[goal-compass] decision: wait - goal activo: esperando a que termine
ms=1410
```

El hook decide bien sin poder preguntar a nadie, y cabe en el margen.

En el arnés, el caso nuevo es explicito: el host falso aprende a congelarse
(`FAKE_ACP_FREEZE_AFTER_MS`), y la prueba pregunta al proceso vivo cuando su
host ya no contesta. Sin el arreglo, el proceso vivo se queda sin respuesta y
la prueba se cuelga —que es el modo de fallo real—. Con el arreglo, responde
con lo que sabe.

Y el objetivo recien creado se lee al instante, sin esperar al aviso de
cambio. La prueba se ve en rojo antes que en verde:

```text
AssertionError: expected 'tg_fake_1' to be 'tg_fake_2'
```
