# Goal Compass Loop

**Encadenar objetivos nativos de MCode automáticamente, con una misión que sobrevive a cada uno.**

Un objetivo nativo se completa y se verifica de verdad. Cuando eso ocurre, un
**supervisor externo** descubre el siguiente trabajo útil y **crea el siguiente
objetivo nativo** — sin que tengas que escribir otro comando. La misión sigue
viva mientras haya trabajo autorizado; cuando no lo hay, queda dormida y
reanudable.

> El modelo **no puede** crear objetivos: el runtime solo le expone `get_goal` y
> `update_goal`. La creación es una acción de producto. Por eso la arquitectura
> es **skill (decide) + supervisor ACP (crea)**, no una skill sola.

**¿Eres nuevo aquí?** Empieza por [`docs/CICLO.md`](docs/CICLO.md): explica el
sistema entero sin jerga y cuenta qué se ha hecho en este ciclo.

## Qué aporta

- **Continuidad real.** El objetivo se autoejecuta al crearlo; el supervisor
  solo tiene que observar y encadenar. Al terminar el turno del agente, el
  hook encadena el siguiente objetivo e inyecta la continuación: el trabajo
  sigue sin que nadie tenga que pedirlo.
- **El hook siempre termina.** Si el host falla o no contesta, el hook se
  rinde, cierra lo que ha arrancado y devuelve el control: el turno nunca se
  queda colgado esperando.
- **Descubrimiento con evidencia.** Los candidatos salen del backlog curado, de
  lo que el propio repositorio dice (pendientes marcados, pruebas omitidas) y,
  cuando no hay nada de eso, de una **exploración acotada** al agente del host.
  La evidencia tiene que señalar a un fichero que exista: sin eso, no hay
  trabajo.
- **El presupuesto guía, no frena.** Cada objetivo recibe un presupuesto; si se
  queda sin margen, ese mismo trabajo vuelve a la cola con el doble
  (120k → 240k → 480k) hasta tres intentos. El total de la misión se mide y se
  enseña, pero no detiene la cadena: una intención continuista necesita tokens
  para cumplirse.
- **Parada útil.** Pausar la misión pausa también el objetivo en curso: deja de
  consumir. Continuar lo reanuda.
- **Sin silencios.** Un objetivo que deja de avanzar no deja la misión colgada
  esperando: la misión queda dormida con el motivo a la vista.
- **Recuperación.** Si el host se cae, el supervisor lo levanta de nuevo, reanuda
  la sesión y sigue. Si el proceso muere entre crear y confirmar, la transición
  se reconcilia sin duplicar nada.
- **Falla cerrado.** Si el host no ofrece la extensión de objetivos, el
  supervisor lo dice y se detiene; no simula que funciona.

## Cómo funciona

```text
MISIÓN (larga vida, fuera del repositorio)
   |
   v
[Supervisor ACP: get / create] --> [Objetivo nativo #1]
        ^                              |
        |                              +-- worker + verificador (runtime)
        |                              |
        |                         complete (durable)
        |                              |
        +-- [Decisión / Candidato] <---+
              |            |
              |            +--> sin candidato -> PARK (misión viva)
              v
          [Objetivo nativo #2] -> ... -> [Objetivo nativo #N]
```

Cada vuelta del supervisor:

1. **Observar** — lee el objetivo real de la sesión.
2. **Decidir** — núcleo puro `Snapshot -> Decision`:
   `create | reconcile | park | wait | escalate`.
3. **Ejecutar** — solo el supervisor crea objetivos. La transición es durable:
   `intención -> create -> read-back -> commit`.
4. **Persistir** — journal atómico (fsync + rename) en
   `~/.local/state/goal-compass/<mission-id>/journal.json`.

### Garantías

| Garantía | Cómo se cumple |
|---|---|
| `complete` es la única puerta a otro objetivo | Decisión pura en `src/core/decide.ts` |
| Notificación repetida no duplica | La autoridad es el **estado**, no el evento |
| Caída entre `create` y `commit` no duplica | `intención` persistida + reconciliación con `get` |
| `blocked`/`paused` no se esquivan | Espera; nunca se crea otro objetivo para eludir una decisión de alguien |
| Un objetivo sin presupuesto no se pierde | El mismo trabajo vuelve a la cola con el doble de margen, hasta tres intentos |
| El hook nunca deja el turno colgado | Tope de espera en toda petición al host, cierre del host y salida siempre |
| Un objetivo que no avanza no cuelga la misión en silencio | Firma de progreso; al vencer el margen, la misión queda dormida con el motivo |
| El presupuesto de la misión es una medida | Se anota y se avisa al superarlo; la cadena sigue |
| El presupuesto mide el gasto de la cadena, no el de tu sesión | Solo se cuentan los objetivos que la cadena creó |
| Sin trabajo útil → `parked`, sin burn de tokens | Sondeo lento, sin llamadas al modelo |
| El objetivo sabe de dónde sale y cómo se demuestra | La evidencia y el criterio de cierre viajan dentro del objetivo |
| Deduplicación por intención, no por texto | Clave estable `objetivo + alcance + criterio` |
| Un solo escritor por sesión | Un host, un supervisor |

## Requisitos

- Node.js ≥ 20 (probado con 25.9.0)
- `mcode` instalado y autenticado, con la función de objetivos habilitada
- **Ninguna dependencia en tiempo de ejecución**: el transporte ACP está
  escrito sobre la biblioteca estándar de Node

Comprobación de compatibilidad:

```bash
npm run build && node dist/cli.js probe --workspace /tmp
```

## Dos formas de usarlo

| | Supervisor en segundo plano | Plugin de MCode |
|---|---|---|
| Quién encadena | Un proceso vivo que va mirando | El cierre de turno del propio agente |
| Dónde ocurre el trabajo | En una sesión ACP propia | **En la sesión del usuario** |
| Encadenado | Continuo, sin depender del chat | En cada cierre de turno |
| Para qué | Missions largas y desatendidas | Trabajar con el agente en su propia sesión |

## Instalación

```bash
npm install
npm run build
```

### 1. Instalar el plugin de MCode (recomendado)

```bash
node dist/cli.js install-plugin        # ensambla el plugin en el marketplace local
mcode plugin add goal-compass -m local # lo registra en MCode
```

El plugin lleva dentro la skill y un hook de `Stop`: cuando el agente
termina su turno, el hook comprueba el objetivo en curso y, si está
terminado, **crea el siguiente en esa misma sesión** y devuelve el turno al
agente. No hay ningún proceso de fondo: el cierre de turno es el latido de la
misión.

Además, el plugin entrega seis herramientas para que el agente pueda mirar
la misión y gobernarla sin salir de la conversación:

| Herramienta | Qué hace |
|---|---|
| `mission_status` | En qué está la misión, cuántos objetivos ha encadenado y qué trabajo hay disponible |
| `mission_declare` | Declara la misión del proyecto cuando todavía no existe; si ya existe, no la toca |
| `mission_propose` | Propone el siguiente objetivo; la evidencia tiene que señalar a un fichero que exista y hace falta decir cómo se sabrá que está hecho |
| `mission_pause` | Pausa la cadena y el objetivo en curso |
| `mission_resume` | Reanuda una misión pausada o dormida |
| `mission_stop` | Termina la cadena |

La propuesta es el camino para cuando no hay trabajo marcado: el agente
investiga, propone con su evidencia, y el cierre de turno siguiente lo
encadena. Una propuesta sobre un fichero que no existe se descarta, y una
propuesta sin criterio de cierre también: la herramienta lo dice en vez de
registrar un trabajo que luego se descartaría en silencio.

Después, en el repositorio donde quieras encadenar, declara la misión. La vía
rápida es el comando:

```bash
node dist/cli.js declare --workspace /ruta/al/proyecto --objective "Mejorar este proyecto"
```

Si prefieres escribirla a mano, el fichero se llama `goal-compass.json` y el
`workspace` se toma del sitio donde vive, así que no hace falta escribirlo.

```json
{
  "missionId": "mejora-continua",
  "objective": "Mejorar y estabilizar este proyecto de forma continua",
  "backlog": [
    {
      "candidateId": "parser-terraform-edges",
      "objective": "Corregir la pérdida de relaciones Terraform al indexar recursos",
      "whyNow": "Se observaron cero aristas para recursos con referencias",
      "evidenceRefs": ["docs/triage.md#terraform-edges"],
      "doneWhen": ["La reproducción que fallaba ahora pasa"],
      "risk": "low",
      "priority": 10,
      "source": "observed"
    }
  ]
}
```

El fichero puede llevar además una lista `executed`: lo que ya se hizo. Es la
memoria del proyecto, y sirve para que la cadena no vuelva a ofrecer trabajo
que ya está pagado:

```json
{
  "missionId": "mejora-continua",
  "objective": "Mejorar y estabilizar este proyecto de forma continua",
  "executed": [
    {
      "candidateId": "parser-terraform-edges",
      "objective": "Corregir la pérdida de relaciones Terraform al indexar recursos",
      "receipt": "PR #12"
    }
  ],
  "backlog": []
}
```

Lo que esté en `executed` no se ofrece como trabajo, ni desde el backlog ni
desde una propuesta, y `mission_propose` rechaza la propuesta de un trabajo ya
hecho. La comparación es por intención: da igual que el objetivo esté escrito
con otras palabras. Si la lista no está, el comportamiento es el de siempre.
Ver [ADR-004](docs/adr/ADR-004-lo-ejecutado-no-vuelve-a-ofrecerse.md) para el
porqué.

### 2. Instalar solo la skill (opcional)

```bash
node dist/cli.js install-skill
```

Copia `skill/goal-compass/` a `~/.minimax/skills/goal-compass/`. Abre una
sesión nueva y comprueba la lista de skills.

La skill gobierna *cómo* se trabaja dentro de un objetivo. El supervisor es
quien encadena.

### 3. Definir la misión del supervisor

El supervisor usa un `mission.json` **fuera del repositorio analizado**:

```json
{
  "missionId": "mejora-continua",
  "objective": "Mejorar y estabilizar este proyecto de forma continua",
  "workspace": "/ruta/al/proyecto",
  "defaultTokenBudget": 120000,
  "totalTokenBudget": 500000,
  "maxGoals": null,
  "stallTimeoutMs": 2700000,
  "explorationEnabled": true,
  "explorationCooldownMs": 1800000,
  "allowRemoteWrite": false,
  "driver": "supervisor",
  "backlog": [
    {
      "candidateId": "parser-terraform-edges",
      "objective": "Corregir la pérdida de relaciones Terraform al indexar recursos, con reproducción mínima",
      "whyNow": "Se observaron cero aristas para recursos con referencias",
      "evidenceRefs": ["docs/triage.md#terraform-edges"],
      "doneWhen": [
        "La reproducción que fallaba ahora pasa",
        "El parser adyacente no se rompe"
      ],
      "scope": "parser/terraform",
      "risk": "low",
      "priority": 10,
      "prerequisites": [],
      "source": "observed"
    }
  ]
}
```

- `evidenceRefs` y `doneWhen` son **obligatorios en la práctica**: un candidato
  sin evidencia o sin criterio observable se descarta.
- `defaultTokenBudget` necesita holgura: el runtime ejecuta worker *y*
  verificador, y ambos consumen presupuesto. Medido en objetivos triviales, el
  consumo real va de 13 000 a 63 000 tokens, y la mayoría ronda los 63 000.
  Con 40 000 nunca llegó a completarse. 120 000 deja margen para un objetivo
  de un turno; si puede necesitar dos, conviene 200 000.
- `totalTokenBudget` es la medida del gasto de la misión entera: al superarlo
  queda anotado y se avisa, pero la cadena no se detiene. Para frenarla de
  verdad, pausa la misión.
- `stallTimeoutMs` es el margen sin avance antes de dar la misión por
  estancada (45 min por defecto). Un objetivo que sigue trabajando cambia de
  turnos o de tokens, así que no se marca por el mero paso del tiempo.
- `explorationEnabled` permite pedir una exploración al agente cuando no hay
  trabajo elegible. `explorationCooldownMs` (30 min por defecto) es el margen
  entre consultas; cada consulta vacia duplica la espera siguiente, hasta un
  tope.
- `priority` (mayor primero), `risk` (`low` < `medium` < `high`), coste y
  `candidateId` definen un orden **determinista**.
- `prerequisites` referencia otros `candidateId`: un candidato con un
  prerrequisito sin completar no es elegible.
- `allowRemoteWrite: false` mantiene `push`, releases y despliegues fuera del
  alcance automático. El supervisor no tiene ninguna ruta que escriba fuera
  del repositorio; lo que hace esta bandera es llevar el límite de la misión
  hasta el agente, que es el único que puede publicar.
- `driver` dice qué camino conduce la misión: `"supervisor"` (el bucle) o
  `"plugin"` (el cierre de turno del agente). **Sin declararlo, lo toma el
  primero que actúa** y el otro se aparta. Declarelo cuando tenga el plugin
  instalado y también vaya a lanzar el supervisor, o cuando quiera que el
  comportamiento no dependa del orden de arranque. La opción vale igual en el
  fichero del plugin (`goal-compass.json`) y en el de la línea de órdenes: el
  camino que no conduce **no abre el host ni escribe en el estado**, se aparta
  entero.

El backlog se relee del fichero en cada ciclo: si añades un candidato mientras
la misión está `parked`, el supervisor lo detecta y reanuda solo.

### 4. Arrancar

```bash
node dist/cli.js init --config ./mission.json   # prepara el estado durable
node dist/cli.js run  --config ./mission.json   # arranca el bucle
```

## Activarlo con un prompt

Es la vía corta, y la que hace falta cuando ya tienes el plugin instalado y
estás trabajando en una sesión de MCode abierta.

**1. Declara la misión del proyecto** (una vez por proyecto):

```bash
node dist/cli.js declare --workspace /ruta/al/proyecto \
  --objective "Mejorar este proyecto paso a paso, con evidencia"
```

El comando deja tres cosas:

- `goal-compass.json` en la raíz del proyecto, con la declaración de la misión.
- `.goal-compass/`, el directorio de trabajo, con su entrada en `.gitignore`.
- El identificador de la misión, derivado del nombre y de la ruta del proyecto
  para que dos proyectos no compartan estado por accidente.

No pisa una declaración que ya exista: si el fichero está a mano, se respeta. Y
declarar dos veces es inofensivo.

**2. Pídeselo a la sesión.** En MCode, con el proyecto abierto:

> Continúa la misión de este repositorio.

El agente carga la skill `goal-compass`, comprueba si hay misión y, si la hay,
la sigue. A partir de ahí, cada vez que termina un objetivo, el hook crea el
siguiente en la misma sesión y le devuelve el turno.

**Ojo con una cosa:** el estado durable se guarda por identificador de misión,
fuera del repositorio. Dos proyectos con el mismo identificador se pisarían, así
que cada proyecto necesita el suyo. Si el repositorio ya trae un
`goal-compass.json` versionado, respeta su identificador; si no, deja que la
herramienta derive uno.

Desde la sesión también se puede declarar sin la línea de órdenes, con la
herramienta `mission_declare` del plugin: necesita un objetivo en una frase y
se encarga del resto.

## Comandos

| Comando | Qué hace |
|---|---|
| `declare --workspace <dir>` | Declara la misión de un proyecto y prepara su directorio de trabajo |
| `init --config <mission.json>` | Prepara el estado durable de la misión |
| `run --config <mission.json>` | Arranca el bucle supervisor |
| `status --mission <id>` | Muestra estado, objetivos, tokens y control pendiente |
| `pause --mission <id>` | Pausa la cadena y el objetivo en curso |
| `resume --mission <id>` | Reanuda una misión pausada o dormida |
| `stop --mission <id>` | Detiene la cadena |
| `probe --workspace <dir>` | Comprueba la extensión ACP contra el host |
| `tree --workspace <dir>` | Prepara el árbol de decisión del proyecto y lo valida |
| `install-skill` | Instala la skill en el directorio del programa |
| `install-plugin` | Ensambla el plugin de MCode en el marketplace local |

Las órdenes del usuario viajan por un fichero de control **aparte** del
journal, de modo que el supervisor —único escritor del journal— nunca pisa tu
orden.

## Estructura

```text
src/
  core/          núcleo puro: tipos y decide.ts (Snapshot -> Decision)
  ports.ts       interfaces de efectos (objetivo, journal, candidatos, exploración…)
  adapters/      acp-transport.ts · acp-goal.ts · journal.ts · control.ts
                 candidates.ts · discovery.ts · exploration.ts · mission.ts
                 proposals.ts · ownership.ts · tree.ts · yaml.ts · workdir.ts
  runtime.ts     montaje de una misión: adaptadores + supervisor
  supervisor.ts  el bucle: observar → decidir → ejecutar → persistir
  plugin/        hook de continuación, servidor de herramientas y ensamblado
  cli.ts         interfaz de línea de comandos
skill/goal-compass/   Skill instalable con el arbol de 13 nodos (markdown + cabecera YAML)
plugin/                Paquete del plugin de MCode (manifiesto, hook, MCP, icono)
spikes/                arnés + escenarios de aceptación contra el host real
test/                  pruebas permanentes y arnés compartido
docs/                  CICLO.md · EVIDENCIA.md · roadmap.md · adr/
spec/                  kit de especificación congelado en la v0.2, como contexto
```

La carpeta `spec/` es el **kit de especificación de la v0.2**, conservado como
documento histórico: explica el encargo, los límites y las decisiones de
entrada. No es el código que se ejecuta. El grafo de la skill que sí se
instala vive en `skill/goal-compass/` y lo comprueba la suite permanente.

[`docs/roadmap.md`](docs/roadmap.md) es el trabajo que falta, con la evidencia
de que hace falta y la condición observable que lo da por terminado. Es
además el backlog de la misión de este repositorio: cada entrada tiene su
ancla, y la cadena encadena la siguiente sin que nadie la escriba a mano.

La **declaración** de esa misión (`goal-compass.json`) no se versiona, igual
que el directorio de trabajo: es configuración local de quien la usa. Si
estuviera en el repositorio, quien lo clonara heredaría una cadena que gasta
tokens de otra persona. El trabajo, en cambio, sí se comparte: está en el
roadmap.

El núcleo no importa nada de los adaptadores. `decide()` no lee ficheros, no
llama a la red y no conoce el reloj: recibe un `Snapshot` y devuelve una
`Decision`.

## El árbol de decisión

La skill que instala el plugin trae un **árbol de decisión**: trece nodos que
dicen, según la señal del momento, qué toca hacer. Cada nodo es un markdown con
una **cabecera YAML** y el prompt debajo:

```yaml
---
id: implement
role: agent          # quién ejecuta el nodo: agent o supervisor
links:
  - to: verify
    rel: next        # next | recover | complete | escalate | discover | await
    when: cambio aplicado                # la señal que activa esta salida
    evidence: comando de prueba preciso  # lo que la sostiene
---
```

La topología vive en la cabecera, no en la prosa: así se puede **validar**
(`npm test` lo comprueba: que todo enlace apunte a un nodo real, que todo nodo
se alcance desde la entrada y que todo nodo tenga salida) y se puede
**sustituir por proyecto**.

Para que un proyecto tenga su propio árbol:

```bash
node dist/cli.js tree --workspace /ruta/al/proyecto
```

Eso deja el directorio de trabajo `.goal-compass/` en su sitio —con su entrada
en `.gitignore`, para no ensuciar el `git status`— y dice qué árbol se está
siguiendo: el del proyecto si tiene el suyo, el de la skill si no.

## Pruebas

```bash
npm test          # pruebas permanentes
npm run uat       # escenarios contra el host real, con recibos
npm run typecheck
```

Las pruebas permanentes cubren: creación del primer objetivo, encadenado tras
`complete`, no duplicado ante notificaciones repetidas, reconciliación tras
caída, escalada por conflicto de autoridad, respeto de los límites del host y
de la misión, pausa y reanudación, `parked` sin candidatos, rechazo sin
evidencia, deduplicación por clave estable y descubrimiento de pendientes.

El **transporte ACP** se prueba contra un host de mentira que es un proceso
real: se comprueba el troceado de los mensajes, el emparejamiento de
respuestas, el ida y vuelta de peticiones y la forma de los errores. El **hook
del plugin** se prueba contra ese mismo host: se comprueba que el objetivo se
crea en la sesión del evento, que la misión queda con la intención confirmada
y que ni un fallo del host ni la falta de tiempo rompen el turno.

La **skill que se entrega** también tiene contrato: cada nodo del grafo tiene
que tener su forma, sus enlaces tienen que apuntar a nodos que existen y hay
que poder llegar a todos ellos y salir de todos ellos. Se comprueba en la
suite permanente, contra el mismo fichero que se instala.

Los escenarios de aceptación (`chain`, `recovery`, `pause`, `budget`,
`exploration`) se ejecutan en un directorio temporal que se borra al terminar.
El arnés monta **las mismas fuentes de trabajo que el producto**, para que los
escenarios no puedan estar probando otro sistema. Su recibo tiene tres
estados: `PASA`, `FALLA` y `NO CORRIO`, este último para cuando el host deja
el trabajo a medias y la comprobación no se pudo hacer.

## Lo que este proyecto NO hace

- **No publica nada por su cuenta.** `allowRemoteWrite` es `false` por defecto.
- **No mide la calidad de la migración entre versiones del host.** La versión
  del protocolo usada por la extensión está documentada y comprobada, pero no
  hay un contrato versionado que la obligue a evolving.

## Evidencia

[`docs/EVIDENCIA.md`](docs/EVIDENCIA.md) recoge los recibos de validación
contra el host real: qué se ejecutó, qué se comprobó y qué quedó sin ejecutar.
