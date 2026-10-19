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
| Dependencias en ejecución | **ninguna**: el transporte ACP usa solo la biblioteca estándar |
| Sistema | Fedora, Linux x86_64 |

---

## 1 · Pruebas permanentes — **PASADO**

```text
$ npm test
 Test Files  7 passed (7)
      Tests  74 passed (74)
   Duration  2.15s

$ npm run typecheck     # sin errores
```

74 pruebas en unos dos segundos. Cubren el núcleo puro, el supervisor con
dobles en memoria, el descubrimiento de señales, los puertos de candidatos, la
exploración, **el transporte ACP** y **el hook del plugin**.

Las dos últimas no se prueban contra una simulación: el transporte y el hook
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
goal-compass@local | 0.5.0 | {'appCount': 0, 'mcpServerCount': 0, 'skillCount': 1} | enabled: True
```

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

## 4 · Escenarios de aceptación contra el host real — **PASADO**

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
[22:00:07.923Z] decision: create - NOTAS.md lo pide de forma explicita ("cubrirla
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

## 5 · Lo que NO se ha ejecutado

- **El plugin no se ha probado en la interfaz gráfica.** La validación se ha
  hecho con `mcode exec`, que es la misma ruta de hooks pero sin pantalla.
- **El plugin no expone todavía un servidor de herramientas.** El agente no
  consulta el estado de la misión con una herramienta; se mira desde fuera, con
  `goal-compass status`.
- **La exploración con modelo no se ejecuta desde el hook.** El hook tiene
  margen de segundos y preguntar al modelo se lo come; la exploración la hace
  el supervisor en segundo plano.
