# Tormenta de ideas · continuidad indefinida

Recogida de ideas para que la cadena no se termine nunca y para que cada
continuación se ajuste al contexto del proyecto en ese momento. Las ideas se
quedan aquí, con el motivo de Integrate o no, para que la decisión sea legible
y no se repita el debate en el próximo ciclo.

## El hueco, con evidencia

De `src/core/decide.ts` (fuente primaria):

- La misión se aparca en cuatro casos: objetivo estancado, `maxGoals` alcanzado,
  presupuesto agotado y **«sin trabajo elegible»**.
- El siguiente objetivo se elige con un orden **estático**: prioridad, riesgo,
  coste e identificador. El `whyNow` es texto decorativo.

De `src/plugin/auto-continue.ts`:

- El hook **no explora**: preguntar al modelo se come el tiempo del turno.
- El prompt de continuación dice «trabaja este objetivo» y nada más.

De ahí sale el hueco: **en la vía del plugin la cadena no se autoalimenta**. Si
el backlog se vacía y nadie propone nada, el hook no encuentra trabajo, el turno
se acaba y la cadena muere con la misión todavía viva. Y el objetivo que
arranca no lleva el contexto del proyecto: el agente vuelve a deducirlo desde
cero en cada turno.

## Ideas

| # | Idea | Qué resuelve |
|---|---|---|
| 1 | **El nodo es un markdown con cabecera YAML**: el prompt y sus metadatos en el mismo fichero | La topología deja de estar escondida en prosa y pasa a ser dato: se puede validar, extender y sustituir por proyecto |
| 2 | **Metadata con dientes**: `role` (quién ejecuta el nodo) y `entry` | Se puede comprobar un invariante real: un nodo de control solo se entra por `discover` o `await` |
| 3 | **La continuación lleva el contexto**: qué se ha hecho, por qué dormía la misión, cuánto presupuesto queda | El agente deja de rededucir el contexto en cada turno |
| 4 | **El objetivo pide dejar el siguiente trabajo** | La cadena se autoalimenta: el agente termina su trabajo y deja su propuesta con `mission_propose` |
| 5 | **La misión nunca muere en silencio**: al aparcar, dice qué falta para seguir | Un parqueo sin explicación es indistinguishable de una misión muerta |
| 6 | **El árbol recuerda el nodo en el que se quedó** | La continuación empieza donde quedó, no en la entrada |
| 7 | **Directorio de trabajo ignorado por git**: el árbol propio del proyecto | Configurable por proyecto y sin ensuciar el repositorio |
| 8 | **La exploración con modelo, también en la vía del plugin** | La fuente infinita de trabajo llega a la vía que hoy no la tiene |
| 9 | **Presupuesto renovable por tramos** | El freno del usuario no puede ser el final del ciclo |
| 10 | **El árbol como fichero único con Includes** | Compartir partes del árbol entre proyectos |

## Qué se integra en este ciclo y por qué

- **1 y 2** → el árbol pasa a ser dato validable. Es la base de todo lo demás y
  es lo que hace falta para que «configurable» signifique algo.
- **3** → la respuesta de continuación ajustada al contexto. Es el texto que el
  agente recibe, y ahora mismo no lleva nada del proyecto.
- **4** → la continuidad indefinida en la vía del plugin. Es el hueco que
  impide que la cadena se autoalimenta.
- **5** → el parqueo dice qué falta, para que un parqueo no parezca una muerte.
- **7** → el árbol propio del proyecto, en un directorio que no ensucia el
  repositorio.

## Qué queda fuera, y por qué

- **6** (recordar el nodo) — requiere que el agente reporte en qué nodo
  terminó, y eso es un contrato nuevo con la superficie de herramientas. Se
  deja para cuando la vía de **4** esté medida: si el agente propone de forma
  fiable, el nodo de entrada puede derivarse de la propuesta sin pedirle nada
  más.
- **8** (explorar desde el hook) — el hook tiene margen de segundos. Se puede
  hacer al revés: que el agente, al cerrar su turno, pregunte al modelo qué
  hacer después. Es lo mismo que **4** visto desde el otro lado.
- **9** (presupuesto renovable) — **hecho, pero de otra manera**: el objetivo
  agotado no muere, vuelve a la cola con el doble de margen. El presupuesto es
  la medida del trabajo, no su freno, y el freno del usuario sigue en pie.
- **10** (includes) — nadie lo ha pedido y un árbol de 13 nodos no lo necesita.

## Lo que se pensó después y sigue fuera

Estas ideas no se integraron, pero la forma de pensar que hay detrás sí se quedó
en el producto:

- **Que el agente cree su propio objetivo.** El host expone al agente
  `get_goal` y `update_goal`, pero no `create_goal`: la clase está en el
  paquete de `mcode` y no se llega a instanciar. Como el objetivo tiene que
  vivir en la sesión del agente, crearlo desde fuera —que es lo que hace el
  plugin— sigue siendo necesario.
- **Que el hook lo arreglara todo.** El hook tenía margen de segundos, y
  cargarle la sesión entera era lo que se lo consumía. La solución fue mover
  esa carga a un proceso que la paga una vez, cuando todavía es barata, no
  estirar el margen.
