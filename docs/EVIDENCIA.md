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
| `chain` | 12 | Tres objetivos encadenados sin intervención; el del medio llega por el canal de propuestas y se encadena en su momento; 107 573 tokens medidos |
| `recovery` | 4 | Un fallo entre crear y confirmar se reconcilia sin duplicar |
| `pause` | 3 | La orden de pausa detiene el trabajo en curso y la de continuar lo reanuda |
| `budget` | 3 | Agotado el presupuesto (67 307 tokens), la cadena se detiene sin crear otro objetivo |
| `exploration` | 4 | Sin backlog ni pendientes marcados, el sistema pide buscar trabajo, encuentra trabajo real y lo encadena, con evidencia que señala a un fichero que existe |

La cadena, con el trabajo del medio llegando por el canal de propuestas:

```text
[00:29:46.647Z] decision: create - trabajo pendiente de la cadena
[00:29:46.656Z] intencion persistida: primero -> 2f4a626e-318d-40be-b3d4-47d75eba7366
[00:29:46.769Z] goal creado y confirmado: tg_yeeq33w6b3mvfy4t9h (active)
[00:32:04.891Z] goal completado registrado: tg_yeeq33w6b3mvfy4t9h (complete(verifier_met))
[00:32:04.900Z] decision: create - propuesto durante la sesion
[00:32:04.909Z] intencion persistida: propuesta:Escribe un fichero llamado resultado-2.txt ...
[00:32:04.953Z] goal creado y confirmado: tg_fkq6vncfa8mvfy7rxs (active)
[00:34:47.099Z] goal completado registrado: tg_fkq6vncfa8mvfy7rxs (complete(verifier_met))
[00:34:47.122Z] decision: create - trabajo pendiente de la cadena
[00:34:47.145Z] intencion persistida: tercero -> afe95a31-b401-42ae-ac0d-025883dd41be
[00:34:47.198Z] goal creado y confirmado: tg_56a77j3duomvfyb94c (active)
```

El orden lo decide la prioridad, no el orden de la lista: el backlog declarado
manda (10), la propuesta va en medio (5) y el segundo backlog detrás (3). La
propuesta no se queda para el final ni se salta.

Y el escenario de exploración, que ya no puede dar por hecho que el trabajo
llega por la exploración, porque con el plugin instalado el agente puede
usar la herramienta de propuestas:

```text
PASA · se encadeno un Goal sin trabajo marcado (origen: propuesta)
PASA · el sistema pidio buscar trabajo
PASA · el Goal viene de una fuente que investigo (propuesta)
PASA · su evidencia senala a un fichero real (src/fechas.ts)
```

Fragmento literal del escenario de exploración, que es el que ejercita la
búsqueda de trabajo con el modelo:

```text
[23:06:02.949Z] sin trabajo elegible: se pide una exploracion acotada del workspace
[23:09:19.346Z] la exploracion aporto 3 candidato(s): la mision continua
[23:09:22.350Z] decision: create - NOTAS.md termina con 'Hay que escribirla y cubrirla
                con una prueba' y no existe ningún fichero de test en el repo. Sin
                congelar el reloj la comprobación sería dependiente de la hora real y
                podría fallar justo en el límite de medianoche; `node:test` lo resuelve
                con `mock.timers.enable({ apis: ['Date'], now: fecha })` y
                `mock.timers.reset()` en `finally` (verificado funcionando en Node 25.9).
```

Ese texto no lo escribió el sistema: lo escribió **el modelo**, leyendo el
repositorio. La exploración es la única fuente de trabajo que no viene de una
lista escrita a mano, y es la que decide.

Y el del freno de gasto, que es el que se encontró **de forma natural** al
agotarse el presupuesto:

```text
[23:05:57.552Z] decision: park - presupuesto de la mision agotado (71708 de 1 tokens); la mision sigue viva
[23:05:57.561Z] mision en parked: presupuesto de la mision agotado (71708 de 1 tokens); la mision sigue viva
```

Y el de la cadena, donde se ve que el trabajo siguiente arranca solo en cuanto
el anterior se completa:

```text
[22:55:18.211Z] decision: create - trabajo pendiente de la cadena
[22:55:18.360Z] goal creado y confirmado: tg_4c6zpza99bmvfurbh2 (active)
[22:57:54.544Z] goal completado registrado: tg_4c6zpza99bmvfurbh2 (complete(verifier_met))
[22:57:54.552Z] decision: create - trabajo pendiente de la cadena
[22:57:54.607Z] goal creado y confirmado: tg_czxq3otv0ymvfuuo3n (active)
```

Estos escenarios se ejecutan **con el transporte ACP propio**, sin ninguna
dependencia externa: la reescritura del transporte no cambió el comportamiento
observable, y los cinco escenarios lo confirman contra el host real.

## 7 · Lo que NO se ha ejecutado

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
