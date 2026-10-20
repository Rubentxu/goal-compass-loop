# ADR-003 · El servidor de herramientas gobierna; no orquesta

**Estado:** aceptado · **Fecha:** 2026-10-20 · **Delimita:** la alternativa
descartada en ADR-007 del kit v0.2 («MCP o HTTP server solo para orquestar el
ciclo»)

## Contexto

El kit de v0.2 descartaba un servidor MCP o HTTP **para orquestar el ciclo**:
el orquestador del ciclo es el supervisor, que ya existe, y duplicar esa
capacidad en un servicio sería tener dos autoridades.

Con la v0.6 se añadió al plugin un servidor de herramientas con cinco
funciones: `mission_status`, `mission_propose`, `mission_pause`,
`mission_resume` y `mission_stop`. Cabe preguntarse si eso no es exactamente lo
que el kit descartaba.

No lo es, y la diferencia está en **quién decide**.

## Decisión

**El servidor de herramientas gobierna la misión; no encadena trabajo.**

| | Decide el trabajo | Crea objetivos |
|---|---|---|
| Servidor de herramientas | No | **No** |
| Supervisor | Sí | Sí |
| Hook del plugin | Sí | Sí |

Concretamente:

- `mission_propose` **deja una propuesta** en un fichero aparte. La cadena la
  encadena quien conduce la misión, en el siguiente cierre de turno.
- `mission_pause`, `mission_resume` y `mission_stop` escriben **órdenes** en el
  canal de control, un fichero aparte del journal. El conductor las aplica.
- El servidor de herramientas **no escribe nunca en el journal**. Ni el
  supervisor ni el hook escriben fuera de él. Siguen siendo tres ficheros
  distintos para tres cosas: el journal, las órdenes y las propuestas.

Consecuencia práctica: el agente puede **ver y gobernar** la misión desde
dentro de la conversación, y el derecho a crear trabajo sigue estando en un
único sitio. Un servicio que además encadenara sería una segunda autoridad
sobre la misma sesión, que es justo lo que el kit descartaba.

## Alternativas descartadas

- **Que `mission_propose` cree el objetivo directamente:** dos autoridades, y el
  agente esquivaría el filtro de elegibilidad (evidencia real y criterio de
  cierre) que protege de inventar trabajo.
- **Un canal de control con escritura desde varios procesos:** rompería el
  «un solo escritor» que el propio kit pedía.
- **Un servidor HTTP en lugar de MCP:** más superficie, menos integración con
  el host, y el mismo alcance.

## Consecuencias

- El alcance del servidor de herramientas queda escrito, para que nadie lo lea
  como una segunda vía de encadenado.
- `mission_propose` tiene que ser **honesto**: si el trabajo que propone no
  cumple las condiciones del motor, el motor lo descartará. Por eso la
  herramienta exige la evidencia y el criterio de cierre, y por eso cuenta
  solo las propuestas utilizables. Una herramienta que prometa un encadenamiento
  que no ocurre es peor que no tener la herramienta.
- La v0.6.1 corrigió precisamente eso: la herramienta contaba como utilizable
  una propuesta que el motor iba a descartar, porque cada uno aplicaba su
  propia idea de qué es trabajo.

## Relación con el resto

- **ADR-002** fija quién conduce la misión y por qué el canal de control y el
  de propuestas son ficheros aparte.
- **ADR-001** (kit v0.2) quedó sustituido por la evolución real: hoy hay
  supervisor, hook y servidor de herramientas, con el alcance que este ADR
  delimita.
