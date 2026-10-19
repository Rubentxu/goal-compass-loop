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
- **Descubrimiento con evidencia.** Los candidatos salen del backlog curado y
  de lo que el propio repositorio dice (pendientes marcados, pruebas
  omitidas), con su ubicación exacta. Sin evidencia no hay trabajo.
- **Freno de gasto.** Límite de tokens por objetivo y límite acumulado para la
  misión completa. Al agotarse, la cadena se detiene sola.
- **Parada útil.** Pausar la misión pausa también el objetivo en curso: deja de
  consumir. Continuar lo reanuda.
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
| Agotado el presupuesto de la misión → `parked` | Contador acumulado de tokens en el núcleo |
| Sin trabajo útil → `parked`, sin burn de tokens | Sondeo lento, sin llamadas al modelo |
| Deduplicación por intención, no por texto | Clave estable `objetivo + alcance + criterio` |
| Un solo escritor por sesión | Un host, un supervisor |

## Requisitos

- Node.js ≥ 20 (probado con 25.9.0)
- `mcode` instalado y autenticado, con la función de objetivos habilitada
- El SDK `@agentclientprotocol/sdk` (dependencia del proyecto)

Comprobación de compatibilidad:

```bash
npm run build && node dist/cli.js probe --workspace /tmp
```

## Instalación

```bash
npm install
npm run build
```

### 1. Instalar la skill (opcional pero recomendado)

```bash
node dist/cli.js install-skill
```

Copia `skill/goal-compass/` a `~/.minimax/skills/goal-compass/`. Abre una
sesión nueva y comprueba la lista de skills.

La skill gobierna *cómo* se trabaja dentro de un objetivo. El supervisor es
quien encadena.

### 2. Definir la misión

Crea un `mission.json` **fuera del repositorio analizado**:

```json
{
  "missionId": "mejora-continua",
  "objective": "Mejorar y estabilizar este proyecto de forma continua",
  "workspace": "/ruta/al/proyecto",
  "defaultTokenBudget": 120000,
  "totalTokenBudget": 500000,
  "maxGoals": null,
  "allowRemoteWrite": false,
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
  verificador, y ambos consumen presupuesto. Un objetivo trivial consumió
  ~50 000 tokens; con 40 000 nunca llegó a completarse. 120 000 deja margen.
- `totalTokenBudget` es el freno de la misión entera; al agotarse, la cadena
  se detiene.
- `priority` (mayor primero), `risk` (`low` < `medium` < `high`), coste y
  `candidateId` definen un orden **determinista**.
- `prerequisites` referencia otros `candidateId`: un candidato con un
  prerrequisito sin completar no es elegible.
- `allowRemoteWrite: false` mantiene `push`, releases y despliegues fuera del
  alcance automático.

El backlog se relee del fichero en cada ciclo: si añades un candidato mientras
la misión está `parked`, el supervisor lo detecta y reanuda solo.

### 3. Arrancar

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

Las órdenes del usuario viajan por un fichero de control **aparte** del
journal, de modo que el supervisor —único escritor del journal— nunca pisa tu
orden.

## Estructura

```text
src/
  core/          núcleo puro: tipos y decide.ts (Snapshot -> Decision)
  ports.ts       interfaces de efectos (objetivo, journal, candidatos…)
  adapters/      acp-goal.ts · journal.ts · control.ts · candidates.ts
                 discovery.ts · mission.ts
  supervisor.ts  el bucle: observar -> decidir -> ejecutar -> persistir
  cli.ts         interfaz de línea de comandos
skill/goal-compass/   Skill instalable con el grafo de 12 nodos
spikes/                arnés + escenarios de aceptación contra el host real
test/                  pruebas permanentes y arnés compartido
docs/                  CICLO.md · EVIDENCIA.md · adr/
```

El núcleo no importa nada de los adaptadores. `decide()` no lee ficheros, no
llama a la red y no conoce el reloj: recibe un `Snapshot` y devuelve una
`Decision`.

## Pruebas

```bash
npm test          # 43 pruebas permanentes: núcleo y supervisor con dobles en memoria
npm run uat       # escenarios contra el host real, con recibos
npm run typecheck
```

Las pruebas permanentes cubren: creación del primer objetivo, encadenado tras
`complete`, no duplicado ante notificaciones repetidas, reconciliación tras
caída, escalada por conflicto de autoridad, respeto de los límites del host y
de la misión, pausa y reanudación, `parked` sin candidatos, rechazo sin
evidencia, deduplicación por clave estable y descubrimiento de pendientes.

Los escenarios de aceptación (`chain`, `recovery`, `pause`, `budget`) se ejecutan
en un directorio temporal que se borra al terminar.

## Lo que este milestone NO hace

- **No controla una sesión ya abierta.** El supervisor gobierna la suya, en un
  host propio. El programa no expone un puente hacia la sesión de la interfaz.
- **No publica nada por su cuenta.** `allowRemoteWrite` es `false` por defecto.
- **La exploración con modelo no está implementada.** El descubrimiento es
  determinista (backlog + señales del repositorio). El puerto de candidatos es
  el punto de extensión para añadirla.
- **No mide la calidad de la migración entre versiones del host.** La versión
  del protocolo usada por la extensión está documentada y comprobada, pero no
  hay un contrato versionado que la obligue a evolving.

## Evidencia

[`docs/EVIDENCIA.md`](docs/EVIDENCIA.md) recoge los recibos de validación
contra el host real: qué se ejecutó, qué se comprobó y qué quedó sin ejecutar.
