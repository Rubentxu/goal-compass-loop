# PRD compacto · Goal Compass

## Problema

Los agentes tienden a seguir el plan inicial aun cuando aparece nueva evidencia, repetir una investigación fallida, aumentar sin control tests/harness o declarar bloqueo sin intentar un experimento diferente. Los routers estáticos seleccionan una skill inicial pero no ayudan a cambiar de ruta *durante* la ejecución.

## Solución

Una Skill router única y nodos pequeños, cada uno con preguntas socráticas (máximo tres), contrato de evidencia, una acción acotada y enlaces para continuar/recuperar/escalar/terminar. Navigation-on-demand; solo leer el nodo actual + uno siguiente. No replicar lógica de goal, ni gestor de tareas, ni almacenamiento de plan por defecto.

## Jobs to be done

- Retomar un objetivo de sesión y hallar la mínima acción útil tras una interrupción.
- Desbloquear por falta de conocimiento, capacidad, permisos, señal de fallo, dependencia o contradicción.
- Elegir investigación, prueba de hipótesis, diseño, planificación, implementación estrecha, verificación o entrega según el estado real.
- Recuperarse de un test rojo sin ampliar innecesariamente el harness.
- Evitar inventar evidencia, repetir intentos idénticos, declarar listo sin comprobación, invocar skills inexistentes y pedir aclaraciones triviales.

## Requisitos funcionales, rastreables

| ID | Requisito | Aceptación |
|---|---|---|
| F01 | Skill `/goal-compass` no colisiona con `/goal` | `/skills` muestra nombre utilizable |
| F02 | Entrar desde cualquier fase, no solo desde inicio | seis prompts diversos eligen nodos pertinentes |
| F03 | Cada nodo revela solo enlaces locales elegibles | salida `ruta actual, evidencia, rel/target/razón` |
| F04 | Cambio de estrategia ante estancamiento | dos iteraciones sin nueva evidencia llevan a `unblock` |
| F05 | Salida informada por pruebas | `finish` nunca declara PASS sin comando/observación |
| F06 | Skill externa opcional | si falta, usa fallback mínimo sin bloqueo injustificado |
| F07 | Diferenciar skill Matt manual vs model-invoked | jamás aseverar invocación automática manual |
| F08 | Reutiliza Goal nativo sin controlar sus internals | sólo sugerencia o composición textual verificable |
| F09 | Sin suciedad del repo | checkpoints efímeros por defecto en conversación o fuera del repo |
| F10 | Siempre posibilidad de `escalate` / `stop` | no ciclos infinitos en el grafo |
| F11 | Limitar alcance de cambios y coste de validación | una intención/cambio y test quirúrgico por iteración |
| F12 | Handoff si cambia de sesión o agente y hay motivo | ficha breve; no tras cada paso |

## No funcionales

- N01: paquete sin servicio/MCP/telemetría/ejecución automática de hooks.
- N02: el router inicial cabe en ~1200 palabras; cada nodo en ~220 palabras objetivo.
- N03: frases en español, lenguaje ubicuo y enlaces relativos; no YAML DSL de reglas obligatoria.
- N04: grafo debe validar referencias con script estándar; una prueba real de MCode se hace manualmente.
- N05: respetar permisos de shell, commits, push, PR y destrucciones; no elevar privilegios.

## Exclusiones

No: reemplazo de `ask-matt`, clonado de Matt skills, automatización de slash commands internos, CI propio, hooks Stop para bucles, runtime web/API, scheduler, métricas persistentes, multiagente obligatorio, suite UAT permanente, prompting enciclopédico.

## Definition of Done producto

Un novato puede instalar el plugin en su perfil, iniciar un objetivo, leer la decisión y saber **qué hace ahora**, **por qué**, **qué comprobará** y **cómo salir si falla**. La prueba se hace contra tres casos reales de la sesión del implementador, sin inventar resultados.
