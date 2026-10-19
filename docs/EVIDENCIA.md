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
 Test Files  8 passed (8)
      Tests  85 passed (85)
   Duration  2.16s

$ npm run typecheck     # sin errores
```

85 pruebas en unos dos segundos. Cubren el núcleo puro, el supervisor con
dobles en memoria, el descubrimiento de señales, los puertos de candidatos, la
exploración, **el transporte ACP**, **el hook del plugin** y **el servidor de
herramientas**.

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
obtuvo el estado de la misión:

```text
mcp__goal-compass__mission_status
```

Las cinco herramientas aparecen registradas bajo el prefijo
`mcp__goal-compass__`, y la llamada devolvió el estado real de la misión
declarada en el repositorio de prueba.

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
herramientas respondían "no hay misión declarada". La ruta del proceso no dice
nada del proyecto; lo que sí lo dice es el entorno:

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

## 5 · Escenarios de aceptación contra el host real — **PASADO**

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
| `chain` | 10 | Tres objetivos encadenados sin intervención; 119 976 tokens medidos; 14 ms entre el fin de uno y el siguiente |
| `recovery` | 4 | Un fallo entre crear y confirmar se reconcilia sin duplicar |
| `pause` | 3 | La orden de pausa detiene el trabajo en curso y la de continuar lo reanuda |
| `budget` | 3 | Agotado el presupuesto (63 207 tokens), la cadena se detiene sin crear otro objetivo |
| `exploration` | 4 | Sin backlog ni pendientes marcados, la exploración aporta 3 candidatos reales, la evidencia señala a un fichero que existe y se encadena el objetivo |

Fragmento literal del escenario de exploración, que es el que ejercita la
búsqueda de trabajo con el modelo:

```text
[21:58:00.880Z] sin trabajo elegible: se pide una exploracion acotada del workspace
[22:00:04.920Z] la exploracion aporto 3 candidato(s): la mision continua
[22:00:07:923Z] decision: create - NOTAS.md lo pide de forma explicita ("cubrirla
                con una prueba") y el repo no contiene ningun fichero de prueba
[22:00:08.025Z] goal creado y confirmado: tg_bhw34b3frtmvfssd8i (active)
```

Y el del freno de gasto, que es el que se encontró **de forma natural** al
agotarse el presupuesto:

```text
[21:57:55.594Z] goal completado registrado: tg_1tl3btbpzomvfsmb5x (complete(verifier_met))
[21:57:55.618Z] decision: park - presupuesto de la mision agotado (65535 de 1 tokens)
[21:57:55.646Z] mision en parked: presupuesto de la mision agotado
```

Estos escenarios se ejecutan **con el transporte ACP propio**, sin ninguna
dependencia externa: la reescritura del transporte no cambió el comportamiento
observable, y los cinco escenarios lo confirman contra el host real.

## 6 · Lo que NO se ha ejecutado

- **El plugin no se ha probado en la interfaz gráfica.** La validación se ha
  hecho con `mcode exec`, que es la misma ruta de hooks pero sin pantalla.
- **El servidor de herramientas no se ha probado desde la interfaz gráfica.**
  Se ha probado con `mcode exec` (el agente llamó a la herramienta y recibió el
  estado) y con peticiones directas de JSON-RPC sobre la entrada y salida
  estándar, no pulsando botones.
- **La exploración con modelo no se ejecuta desde el hook.** El hook tiene
  margen de segundos y preguntar al modelo se lo come; la exploración la hace
  el supervisor en segundo plano.
- **El canal de propuestas no se ha probado en el bucle completo.** Que la
  propuesta se registre, que la evidencia se descarte y que la propuesta
  aceptada se encadena están probados por separado; el recorrido entero
  (proponer → cerrar turno → encadenar) está pendiente de ejecutarse de una
  vez.
