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
  solo tiene que observar y encadenar.
- **Descubrimiento con evidencia.** Los candidatos salen del backlog curado, de
  lo que el propio repositorio dice (pendientes marcados, pruebas omitidas) y,
  cuando no hay nada de eso, de una **exploración acotada** al agente del host.
  La evidencia tiene que señalar a un fichero que exista: sin eso, no hay
  trabajo.
- **Freno de gasto.** Límite de tokens por objetivo y límite acumulado para la
  misión completa. Al agotarse, la cadena se detiene sola.
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
| `blocked`/`paused`/`budget_limited`/`usage_limited` no se esquivan | Espera; nunca se crea otro objetivo para eludir un límite |
| Un objetivo que no avanza no cuelga la misión en silencio | Firma de progreso; al vencer el margen, la misión queda dormida con el motivo |
| Agotado el presupuesto de la misión → `parked` | Contador acumulado de tokens en el núcleo |
| Sin trabajo útil → `parked`, sin burn de tokens | Sondeo lento, sin llamadas al modelo |
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

Además, el plugin entrega cinco herramientas para que el agente pueda mirar
la misión y gobernarla sin salir de la conversación:

| Herramienta | Qué hace |
|---|---|
| `mission_status` | En qué está la misión, cuántos objetivos ha encadenado y qué trabajo hay disponible |
| `mission_propose` | Propone el siguiente objetivo; la evidencia tiene que señalar a un fichero que exista y hace falta decir cómo se sabrá que está hecho |
| `mission_pause` | Pausa la cadena y el objetivo en curso |
| `mission_resume` | Reanuda una misión pausada o dormida |
| `mission_stop` | Termina la cadena |

La propuesta es el camino para cuando no hay trabajo marcado: el agente
investiga, propone con su evidencia, y el cierre de turno siguiente lo
encadena. Una propuesta sobre un fichero que no existe se descarta, y una
propuesta sin criterio de cierre también: la herramienta lo dice en vez de
registrar un trabajo que luego se descartaría en silencio.

Después, en el repositorio donde quieras encadenar, crea `goal-compass.json`
con la declaración de la misión. El `workspace` se toma del sitio donde vive
el fichero, así que no hace falta escribirlo.

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
- `totalTokenBudget` es el freno de la misión entera; al agotarse, la cadena
  se detiene.
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

## Comandos

| Comando | Qué hace |
|---|---|
| `init --config <mission.json>` | Prepara el estado durable de la misión |
| `run --config <mission.json>` | Arranca el bucle supervisor |
| `status --mission <id>` | Muestra estado, objetivos, tokens y control pendiente |
| `pause --mission <id>` | Pausa la cadena y el objetivo en curso |
| `resume --mission <id>` | Reanuda una misión pausada o dormida |
| `stop --mission <id>` | Detiene la cadena |
| `probe --workspace <dir>` | Comprueba la extensión ACP contra el host |
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
                 proposals.ts
  runtime.ts     montaje de una misión: adaptadores + supervisor
  supervisor.ts  el bucle: observar → decidir → ejecutar → persistir
  plugin/        hook de continuación, servidor de herramientas y ensamblado
  cli.ts         interfaz de línea de comandos
skill/goal-compass/   Skill instalable con el grafo de 12 nodos
plugin/                Paquete del plugin de MCode (manifiesto, hook, MCP, icono)
spikes/                arnés + escenarios de aceptación contra el host real
test/                  pruebas permanentes y arnés compartido
docs/                  CICLO.md · EVIDENCIA.md · adr/
spec/                  kit de especificación congelado en la v0.2, como contexto
```

La carpeta `spec/` es el **kit de especificación de la v0.2**, conservado como
documento histórico: explica el encargo, los límites y las decisiones de
entrada. No es el código que se ejecuta. El grafo de la skill que sí se
instala vive en `skill/goal-compass/` y lo comprueba la suite permanente.

El núcleo no importa nada de los adaptadores. `decide()` no lee ficheros, no
llama a la red y no conoce el reloj: recibe un `Snapshot` y devuelve una
`Decision`.

## Pruebas

```bash
npm test          # 95 pruebas permanentes
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
