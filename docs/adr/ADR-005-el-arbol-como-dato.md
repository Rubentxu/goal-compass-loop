# ADR-005 · El árbol como dato, no como prosa que interpreta el agente

**Estado:** aceptado · **Fecha:** 2026-10-22 · **Sustituye a:** el contrato de
enlaces del kit v0.2 (spec/docs/03-contratos.md), que era prosa dentro de un
Markdown

## Contexto

El árbol de la skill dice qué nodo se abre y cuándo: el índice apunta a
`grill`, a `unblock`, a `finish`; cada nodo declara a dónde puede ir después.
El problema no era qué nodos había, sino **cómo se expresaba la señal**.

En el contrato del kit v0.2, el frontmatter era una frase que el agente
leía e interpretaba: «cuando el trabajo en curso no avanza», «si no queda
ninguna fase». Eso tiene tres problemas que solo se ven cuando el árbol
empieza a gobernar de verdad:

1. **No es comprobable.** «El trabajo no avanza» es un juicio, y un juicio
   no se puede verificar ni escribir una prueba que lo compruebe.
2. **No es estable.** El mismo árbol, leído por dos agentes distintos,
   producía decisiones distintas: la frase admite lecturas, y el que la
   hace es quien la hace.
3. **No se puede instalar.** Escribir las trece fichas a mano, con su
   frontmatter en prosa y sin forma de saber si están bien, era el precio
   de empezar un proyecto con el árbol.

Mientras el árbol fuera una guía de lectura, esto no era un problema: nadie
prometía que el árbol decidiera nada. El problema apareció cuando el árbol
pasó a ser lo que **gobierna** el ciclo.

## Decisión

**El frontmatter del árbol es un dato, y el texto sigue siendo la lectura
del LLM.**

Cada nodo declara:

- `id` y `role`, y el índice declara `entry: true`.
- `links`, y cada enlace declara `rel` (la relación: `next`, `recover`,
  `complete`, `escalate`, `discover`, `await`), `to` (el nodo de destino),
  `when` (la señal que justifica el enlace) y `evidence` (lo que prueba que
  la señal se cumple).

El texto del nodo no se borra: es lo que el agente lee para entender
**por qué**; el `when` es lo que se puede comprobar. Son dos lecturas del
mismo dato, no dos fuentes de verdad.

`src/adapters/tree.ts` **interpreta y valida** el YAML: el árbol tiene que
cargar, y sus enlaces tienen que apuntar a nodos que existen. Lo que no
hace —y por diseño— es *gobernar la ejecución*: el árbol da la decisión,
el núcleo la aplica.

Y el árbol se instala entero, para que un proyecto no empiece escribiendo
fichas a mano: `goal-compass install-skill` deja el árbol en la skill, y
`skill/goal-compass/graph/` es la forma de partida.

## Alternativas descartadas

- **Dejar el frontmatter en prosa y aceptar que el agente lo interprete:**
  es lo que había. Se descartó porque las dos decisiones que el árbol
  tiene que tomar —abrir `unblock` o abrir `finish`— acababan siendo del
  agente, y una decisión que no se puede comprobar no se puede depurar.
- **Escribir el árbol en código, como un módulo de rutas:** el runtime lo
  leería más rápido, pero se pierde la fuente única. El árbol es lo que se
  instala, lo que el agente lee y lo que la suite comprueba; si vive en
  código, la skill instalada y el código dejan de ser lo mismo.
- **Dejar solo señales y borrar el texto:** la señal sirve para decidir,
  no para entender. Un árbol de señales sin explicación obliga al agente a
  obedecer una tabla, y no puede razonar sobre lo que hace.
- **Una señal, pero en el cuerpo del nodo, no en el frontmatter:** se
  mezclaría el dato con la explicación, y el validador no podría separar
  una cosa de la otra.

## Consecuencias

- El árbol deja de ser una guía de lectura y pasa a ser la entrada del
  runtime: `when` es comprobable, y sobre `when` se puede escribir una
  prueba.
- Empezar un proyecto con el árbol no exige escribir trece fichas: se
  instala el árbol y se sustituye lo que haga falta.
- Los enlaces del árbol pasan a tener una forma única. Los nodos que
  cambiaron su frontmatter tienen que cambiar con él.
- `src/adapters/tree.ts` deja de crecer validar: valida, y no gobierna. La
  frontera queda explícita.

## Qué fixture deja de ser válido

**El contrato de enlaces del kit v0.2.** En `spec/docs/03-contratos.md` la
sección «Enlaces» describe los enlaces como Markdown relativo con
`rel=<next|recover|complete|escalate|inspect>`, `si=<condición>` y
`evidencia=<salida esperada>`. Ese contrato queda sustituido por el
`links:` del frontmatter, con `to`, `rel`, `when` y `evidence`. Un árbol
escrito al contrato viejo **no valida**: sus enlaces no se ven.

Los ficheros del kit en `spec/` se conservan como documento histórico, no
como contrato vigente. El contrato vigente es el que leen
`skill/goal-compass/graph/` y `src/adapters/tree.ts`.

## Relación con el resto

- **ADR-002** (una misión, un conductor) decide quién encadena; este decide
  con qué señal se decide qué nodo se abre.
- **ADR-004** (lo ejecutado no vuelve a ofrecerse) es la regla que hace
  que el árbol tenga un grafo real y no un ciclo.
