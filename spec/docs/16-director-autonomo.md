# 16 · Director autónomo: de encadenador a director de ingeniería

> Sustituye a la política de espera de `14-protocolo-supervisor.md` y al gate G4
> de `15-uat-y-limites.md`. El hardware —supervisor ACP, skill con frontmatter,
> grafo, adaptadores, journal— se conserva; lo que cambia es la política que los
> conecta.

## Problema

La política actual se aproxima a:

> Completar Goal → buscar candidato elegible → crearlo o aparcar la misión.

Con eso, el sistema interpreta demasiadas situaciones como motivo para dejar de
trabajar, cuando deberían ser **señales para cambiar de estrategia**. Una tarea
bloqueada detiene hoy a toda la misión, aunque haya seis tareas ejecutables
detrás.

## Principio

La política pasa a ser:

> Mientras exista trabajo pendiente, incertidumbre resoluble o una mejora
> justificada dentro de la misión, buscar la siguiente acción que permita avanzar.

Incluye: resolver bloqueos y dependencias, investigar cuando falten datos,
dividir trabajos demasiado grandes, crear subtareas con sus dependencias,
incorporar mejoras descubiertas durante la ejecución, repriorizar con evidencia
nueva, cambiar de tarea cuando otra no avanza, hacer revisión adversarial y
corregir, y cerrar el bloque sin necesitar otro prompt del usuario.

### Invariante de progreso

> Si la misión tiene trabajo pendiente, el sistema debe poder demostrar una de
> estas dos cosas: que ejecuta una acción que contribuye a completarlo, o qué
> condición externa verificable impide cualquier acción autorizada.

Una tarea bloqueada **nunca** justifica por sí sola detener la misión completa.

### Tres situaciones, no una

| Situación | Comportamiento |
|---|---|
| Hay trabajo realizable | Continuar con el mejor candidato |
| Un trabajo está bloqueado | Recuperar: investigar, descomponer, cambiar de estrategia o **elegir otro trabajo** |
| No existe ninguna acción autorizada y realizable | Esperar una condición externa, conservando la misión y reanudándola cuando cambie |

Ser autónomo **no** significa ignorar al usuario ni al host. Las órdenes
explícitas de detener o pausar, los permisos y las cuotas reales se respetan
siempre. El punto es que un bloqueo en un objetivo no se convierta
automáticamente en el bloqueo de la misión.

## Dónde falla hoy

| Código | Problema | Evolución |
|---|---|---|
| `src/core/decide.ts` | Sin candidatos elegibles devuelve `park` | Decidir acciones de recuperación, investigación o expansión |
| `src/supervisor.ts` | `executePark()` deja la misión dormida | Orquestar la recuperación y volver a seleccionar |
| `src/plugin/auto-continue.ts` | Desactiva la exploración en el hook | Encadenar Goals específicos de investigación sin bloquear el hook |
| `src/adapters/discovery.ts` | Solo detecta TODO/FIXME y tests omitidos | Descubrir deuda, drift, especificaciones pendientes |
| `src/adapters/proposals.ts` | Permite proponer, no gestionar el roadmap | Añadir edición, priorización y descomposición |
| `src/adapters/tree.ts` | Interpreta y valida YAML, no gobierna ejecución | Router de decisiones con resultados tipados |
| `src/runtime.ts` | La misión sale del journal y la declaración nunca se relee | Reconciliar declaración ↔ journal en cada ciclo |
| `src/adapters/journal.ts` | Guarda Goals, no el razonamiento | Persistir checkpoints, decisiones, experimentos y revisiones |

El punto crítico es `decide.ts`: cuando no encuentra nada elegible no dispone
de una decisión que signifique «produce la información necesaria para poder
continuar». El progreso no es solo ejecutar una tarea; también es descubrir cómo
hacerla ejecutable.

## Arquitectura: árbol reactivo con memoria

No es un árbol clásico que se recorre una vez de la raíz a la hoja. Es una
combinación de tres técnicas:

- **Behavior Tree reactivo** — seleccionar alternativas y reintentarlas con
  condiciones cambiantes.
- **Grafo de dependencias** — qué tareas están disponibles ahora mismo.
- **Evaluación del LLM** — interpretar lo ambiguo y proponer acciones; el núcleo
  determinista valida elegibilidad y efectos.

No hace falta entrenar un árbol con CART, ID3 o C4.5: esos construyen
clasificadores desde datos; aquí hace falta un sistema de decisión operativo con
alternativas y condiciones cambiantes.

### Regla de oro del coste

**No gastar un turno de razonamiento en lo que ya se puede resolver
determinísticamente.** Si hay un candidato de máxima prioridad, con
prerrequisitos cumplidos y evidencia válida, se selecciona sin llamar al LLM.
La puntuación ordena candidatos; nunca sustituye a las dependencias ni a las
restricciones.

### Selector: reglas, no pesos

1. Resolver primero las transiciones pendientes y las órdenes del usuario.
2. Construir la **frontera ejecutable**: tareas abiertas con prerrequisitos cumplidos.
3. Si hay frontera, ordenar por prioridad, valor, riesgo, coste y antigüedad.
4. Si no hay frontera pero hay backlog: analizar dependencias, detectar ciclos y
   buscar el bloqueo **más cercano que se pueda resolver**.
5. Si falta conocimiento: crear un Goal de investigación con pregunta verificable.
6. Si el roadmap está vacío: iniciar una **auditoría de cumplimiento y deuda**,
   no una espera inmediata.
7. Solo declarar la misión terminada cuando se demuestren sus criterios globales.

## Árbol ejecutable

El frontmatter deja de ser una frase que interpreta el agente: `when` pasa a ser
una **señal tipada** que el runtime puede comprobar, manteniendo el texto para el
LLM.

```yaml
---
id: unblock
role: agent
kind: recovery
requires: [mission_snapshot, blocker_evidence]
produces: [diagnosis, candidate_proposals, decision_receipt]
limits:
  max_equivalent_attempts: 2
  require_new_evidence: true
links:
  - to: research
    rel: recover
    when: root_cause_unknown
    evidence: missing_information
  - to: to-tickets
    rel: next
    when: dependency_decomposition_needed
    evidence: dependency_graph
  - to: choose-next
    rel: recover
    when: independent_work_available
    evidence: executable_candidate
---
```

Los predicados se nombran, **no son expresiones JavaScript**: así el grafo y sus
transiciones se validan estáticamente.

El runtime ejecuta siempre el mismo protocolo:

1. Leer el snapshot y el nodo actual.
2. Preparar **solo** el contexto requerido.
3. Ejecutar el prompt con MCode.
4. Recibir una observación estructurada.
5. Validar evidencia, permisos y resultado.
6. Evaluar los enlaces permitidos.
7. Persistir decisión y checkpoint.
8. Continuar por el enlace seleccionado.

El LLM **no inventa enlaces ni declara algo completado por su cuenta**: elige
entre posibilidades definidas y propone datos; el supervisor verifica antes de
aplicar efectos.

### Catálogo de nodos

| Nodo | Inspiración | Cuándo se ejecuta |
|---|---|---|
| `orient` | ask-matt / router | Identificar el estado y elegir camino |
| `wayfinder` | wayfinder | Proyecto grande, ruta aún incierta |
| `grill-with-docs` | grilling + domain-modeling | Resolver contradicciones y vocabulario |
| `research` | research | Falta información externa o de arquitectura |
| `diagnose` | diagnosing-bugs | Error o regresión reproducible |
| `experiment` | prototype / autoresearch | Contrastar hipótesis con pruebas pequeñas |
| `to-spec` | to-spec | Convertir decisiones en contratos persistentes |
| `to-tickets` | to-tickets | Descomponer y construir dependencias |
| `implement` | implement + TDD | Cambio acotado y definido |
| `implement-graph` | implement-spec | Varias tareas independientes y paralelizables |
| `verify` | TDD / aceptación | Probar el comportamiento real |
| `adversarial-review` | code-review + crítica independiente | Buscar errores, drift y huecos |
| `unblock` | diagnóstico + wayfinding | Una estrategia no progresa |
| `replan` | router + feedback | Cambiaron prioridades o dependencias |
| `retro` | retro | Convertir defectos del ciclo en mejoras duraderas |
| `deliver` | release | Integrar y publicar un bloque aceptado |
| `choose-next` | supervisor | Seleccionar el próximo Goal |
| `mission-audit` | auditoría de cierre | Demostrar si queda trabajo necesario |

Los nodos **no se ejecutan todos obligatoriamente**: un bug pequeño sigue
`diagnose → implement → verify → deliver`; un cambio arquitectónico sigue
`wayfinder → grill-with-docs → to-spec → to-tickets → implement-graph →
adversarial-review → deliver`.

### No depender de invocaciones imposibles

Algunas skills de Matt Pocock exigen invocación explícita del usuario y no
siempre pueden llamarse desde otra skill. Por eso los nodos ofrecen **su propio
procedimiento** inspirado en el contrato; cuando una skill compatible está
disponible, delegan en ella. Así la misión no queda atada a un host, a un
marketplace ni a un nombre de comando.

## El adversario que responde

Dos funciones distintas en `adversarial-review`:

- **Revisión técnica** — examina código, contratos y pruebas buscando defectos concretos.
- **Contradicción de decisiones** — recibe la hipótesis del agente principal e
  intenta refutarla con evidencia independiente.

Ejemplo de encargo: *la propuesta es crear un motor de workflows nuevo para
resolver la continuidad del plugin; busca una solución más sencilla dentro de los
seams existentes, identifica contradicciones y presenta evidencia que permita
elegir.*

Debe devolver un artefacto estructurado: **objeción, evidencia, alternativa y
prueba discriminante**. Si encuentra un defecto reproducible genera trabajo para
el roadmap; si solo expresa una preferencia, **no bloquea la entrega**.

Se implementa como subagente independiente y de solo lectura, o como segunda
sesión ACP aislada. Dos roles leídos consecutivamente en el mismo contexto **no**
son dos agentes independientes. Hay que impedir desde el supervisor que el
adversarial delegue la revisión otra vez y se multiplique.

## Roadmap vivo, gestionado por prompts

El agente debe entender órdenes como «reprioriza el roadmap para estabilizar
primero las APIs públicas», «investiga el stream de eventos y añade las
correcciones con sus dependencias» o «elimina del backlog lo ya demostrado y
continúa con lo pendiente», sin obligar a editar JSON ni Markdown.

| Herramienta | Funcionalidad |
|---|---|
| `roadmap_get` | Consultar tareas, hitos, bloqueos y dependencias |
| `roadmap_apply` | Añadir, actualizar, dividir, repriorizar o cerrar trabajo |
| `roadmap_explain` | Explicar por qué una tarea es prioritaria o está bloqueada |
| `mission_status` | Progreso, objetivo actual y siguiente decisión |
| `mission_propose` | Canal actual de descubrimiento y propuestas |

`roadmap_apply` admite operaciones tipadas (`add`, `update`, `split`,
`reprioritize`, `complete`) con validación de permisos, revisión esperada del
roadmap y escritura atómica, y devuelve un resumen legible del antes y el
después.

**Una sola fuente de verdad:** `docs/roadmap.md`. El adaptador actualiza ese
fichero y sincroniza la proyección operativa de candidatos; no se mantienen dos
backlogs que diverjan. El identificador de una tarea es estable aunque cambien
título, alcance o criterio; el título normalizado sigue sirviendo para detectar
duplicados, pero no es la identidad primaria.

### Política de expansión

Se puede crear trabajo nuevo cuando: un bloqueo exige una tarea previa; una
investigación descubre un defecto reproducible; la revisión adversarial demuestra
un incumplimiento; una especificación existente no está implementada; se
detecta deuda con impacto y criterio de aceptación; o hace falta dividir una
tarea para hacerla verificable.

Cada creación **conserva la referencia al hallazgo que la originó** y al objetivo
de misión que ayuda a cumplir. Así se evitan los dos extremos: un roadmap rígido
que no aprende y un roadmap infinito donde el agente inventa mejoras.

## Autoresearch: hipótesis, experimento, decisión

Bucle dentro del supervisor, no sustituto suyo: **hipótesis → experimento
acotado y reversible → evaluación → decisión (conservar, descartar o
investigar)**.

Cada experimento deja un recibo compacto con hipótesis, línea base, resultado,
decisión, evidencia y siguiente paso:

```yaml
experiment:
  hypothesis: "Eliminar la conversión intermedia reduce la latencia"
  baseline: { p95_ms: 140 }
  result:   { p95_ms: 92 }
  decision: keep
  evidence: ["bench/results.json"]
```

La métrica depende del objetivo: latencia, memoria, errores, regresiones,
complejidad o un criterio funcional binario. **Un número arbitrario nunca
sustituye a la aceptación.** Cuando dos experimentos equivalentes no producen
información nueva, el sistema va a `unblock` o `wayfinder`: no repite
aumentando el presupuesto indefinidamente.

## Meses de trabajo

El plugin actual **no** es un supervisor permanente independiente de la sesión:
el hook `Stop` corre al cerrar un turno y el keeper está ligado al ciclo de vida
de la sesión que lo inició. Sobrevive a cierres de turno, no a cierres de MCode.

| Modo | Comportamiento |
|---|---|
| **Session Loop** | Continúa mientras la sesión MCode funciona; aprovecha keeper y hooks actuales |
| **Durable Mission** | Supervisor local persistente, habilitado expresamente, que recupera el journal y reabre sesiones ACP cuando toque y esté autorizado |

La autonomía duradera necesita además: checkpoint por Goal (tarea, decisión,
evidencias, experimento activo, revisión del roadmap), reconciliación de
operaciones incompletas sin repetir efectos remotos, memoria acotada (la misión
y los documentos pertinentes, no meses de transcripciones), detección de
estancamiento que **cambie de estrategia** en vez de detener, control de recursos
sin esquivarlos, y **cierre demostrable**: distinguir «misión completada» de
«misión sin candidatos».

Para cerrar la misión se exige una auditoría independiente: hitos obligatorios
entregados, criterios globales satisfechos, deuda crítica resuelta o
explícitamente aceptada, y ausencia de trabajo necesario pendiente.
**«No hay tareas» no es «hemos terminado»** — pero tampoco obliga a generar
trabajo irrelevante para no detenerse.

La publicación puede autorizarse una vez para toda la misión, con ámbito limitado
a repositorios, ramas y operaciones, sujeta siempre a los permisos del host.

## Harness de pruebas

Reutilizar los contratos de MCode (`host-integration-testkit`,
`host-integration-settlement`, `continuation`, `acp-agent`) como **referencia de
comportamiento**, sin copiar su harness ni importar su API interna.

| Nivel | Técnica | Qué valida |
|---|---|---|
| L1 · Núcleo | Snapshots, reloj simulado, decisiones puras | Miles de transiciones sin gastar tokens |
| L2 · Integración | Host ACP mínimo, procesos y sockets reales | Keeper, hooks, concurrencia, recuperación |
| L3 · Aceptación | Binario MCode real vía ACP y plugin empaquetado | Comportamiento autónomo visible |

Los tres gates juntos por debajo de 15 minutos. Para simular meses no hacen
falta miles de Goals reales: una secuencia sintética de eventos, cambios de
roadmap, caídas y actualizaciones del host, comprobando las decisiones
producidas. Solo los contratos críticos necesitan ejecución real.

Escenarios obligatorios: backlog ejecutable → crea Goal; primera tarea
bloqueada por dependencia → elige o genera desbloqueo; investigación que
encuentra tres defectos → añade tareas justificadas; repriorización por prompt →
actualiza y la siguiente selección cambia; revisión adversarial detecta
regresión → reabre el trabajo; caída entre `create` y confirmación → **no
duplica**; backlog vacío con misión incompleta → auditoría acotada; roadmap
terminado → audita antes de declarar completa; cuota o permiso denegado → **no se
elude**, conserva estado y se retoma.

Cada UAT se ejecuta en un directorio temporal aislado, con presupuesto de tiempo
y limpieza obligatoria; después se conservan los recibos y se elimina el harness.

## Hitos

| Hito | Versión | Alcance | Aceptación |
|---|---|---|---|
| **H0** | v0.15.0 | Cerrar P0/P1: lockfile, conciliación de estados, keeper, control, recuperación | Un Goal recupera su estado sin duplicar y el producto instala limpio |
| **H1** | v0.16.0 | Selector que busca alternativas y desbloqueos antes de esperar; distinguir bloqueo de tarea, cuota y restricción humana | Una tarea bloqueada con trabajo alternativo nunca paraliza la misión |
| **H2** | v0.17.0 | Árbol YAML ejecutable: señales tipadas, resultados estructurados, rutas de recuperación, nodos del catálogo | El agente sigue caminos distintos según evidencia observable |
| **H3** | v0.18.0 | Roadmap agent-first: consultar, modificar, priorizar, descomponer y cerrar desde prompts, con identificador estable | El agente modifica el roadmap y demuestra por qué cada tarea nueva pertenece a la misión |
| **H4** | v0.19.0 | Experimentos con evaluación y memoria, crítica independiente, detección de estancamiento, replanificación | Un fallo o investigación fallida produce conocimiento o estrategia nueva, no un ciclo repetido |
| **H5** | v0.20.0 | Modo persistente opcional, recuperación entre sesiones, auditoría global, integración Git y publicación gobernada | Completar un roadmap de varios hitos con reinicios, cambios de prioridad, entregas y comprobación final |

El núcleo de decisiones y el parser pueden empezar en paralelo una vez fijados
los contratos; la interfaz MCP del roadmap evoluciona aparte; el harness prepara
fixtures en paralelo. **El protocolo de decisiones, la semántica de bloqueo y el
journal tienen un único responsable**: son contratos transversales, y
repartirlos sin coordinación genera más trabajo de integración del que ahorra.

Se mide el rendimiento por **hitos aceptados y entregados por unidad de coste**,
nunca por Goals creados ni por turnos: si no, se optimiza la actividad en lugar
del progreso.

## Qué se deja de valer

- `15-uat-y-limites.md` §G4 — «sin backlog: si no encuentra candidato, `parked`
  y espera cambio» pasa a ser «sin backlog: auditoría de cumplimiento o
  investigación acotada; solo se espera con una condición externa verificable».
- La lectura de `parked` como salida normal del ciclo.