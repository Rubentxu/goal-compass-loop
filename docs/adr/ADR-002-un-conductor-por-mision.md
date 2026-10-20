# ADR-002 · Una misión, un conductor

**Estado:** aceptado · **Fecha:** 2026-10-20 · **Sustituye a:** la suposición de
«un solo escritor» del kit v0.2 (ADR-007), que solo era cierta para el fichero

## Contexto

Hay dos caminos que pueden encadenar objetivos sobre la misma misión:

- **El supervisor**, que mira en bucle y crea el siguiente cuando el objetivo en
  curso termina.
- **El hook del plugin**, que crea el siguiente cuando el agente cierra su
  turno.

Los dos escriben en el mismo journal, leen el mismo host y **ven el objetivo
terminado en el mismo instante**: el cierre de turno del agente ocurre justo
cuando el supervisor lo nota en su siguiente sondeo. Sin una regla que los
separe, los dos deciden crear y se crean dos objetivos para el mismo trabajo.
Uno se queda huérfano y sus tokens se pierden.

El kit de v0.2 ya lo decía: «Mantener un solo writer y fail-closed ante límites
del host». El problema es que «un solo writer» se aplicaba al fichero —que se
escribe de forma atómica— y no a la **decisión**, que es lo que se duplica.

Además, el journal se reescribía entero en cada cierre de turno, aunque el hook
no tuviera nada que hacer: eso puede pisar lo que el supervisor acaba de
escribir.

## Decisión

**Una misión la conduce un camino, y el otro se aparta.**

1. **Declaración.** El fichero de misión puede declarar `"driver":
   "supervisor" | "plugin"`. Si lo declara, es la ley: el otro camino no
   encadena, no crea y no escribe, y dice por qué.
2. **Mando.** Sin declaración, el mando se lo toma el primero que actúa. El
   mando es un **arrendamiento**: caduca a los cinco minutos sin refreshing, y
   pasado ese tiempo lo puede tomar cualquiera. Un proceso muerto no puede
   dejar la misión atada.
3. **Candado.** Aunque el mando se haya repartido bien, la ventana de
   encadenado se protege con un candado exclusivo (`chain.lock`, creado en
   exclusiva). Dos vías no pueden crear a la vez. El candado también caduca, y
   su dueno muerto no lo deja colgado.
4. **Apartarse es no tocar nada.** El camino que no conduce **no abre el host,
   no escribe en el journal y no deja el estado a medias**. Antes, el hook
   abría una sesión del host y reescribía el journal entero en cada cierre de
   turno, aunque no tuviera nada que encadenar: eso podía pisar lo que el
   supervisor acababa de escribir. Ahora se aparta entero y dice por qué.
5. **El journal se guarda solo si cambió algo.** Una escritura sin motivo es
   una forma de pisar lo que otro proceso acaba de escribir.

El estado durable deja el conductor a la vista (`goal-compass status` lo
enseña), de modo que la causa de un comportamiento raro se puede leer sin
adivinar.

## Alternativas descartadas

- **Un mutex alrededor de cada escritura del journal:** no vale. El problema no
  es escribir a la vez, es *decidir* a la vez. Serializar las escrituras no
  serializa las decisiones.
- **Que el supervisor gane siempre:** dejaría al plugin inservible, que es el
  camino recomendado.
- **Que gane el hook siempre:** dejaría al supervisor inservible, y es el
  camino que usa la gente que no quiere instalar el plugin.
- **Un contrato de leasing distribuido con renovaciones:** más machinery del
  que el problema necesita. La expiración por antigüedad cubre el caso real
  (un proceso que muere) y el candado cubre la carrera.

## Consecuencias

- El invariante de «un solo escritor» pasa a ser cierto para la decisión, que
  es donde estaba roto.
- Las pruebas de aceptación pueden **declarar** el conductor y medir un solo
  camino. Antes, con el plugin instalado, el hook se adelantaba y el
  escenario `exploration` medía el hook y no el supervisor.
- Un usuario que tenga el plugin instalado y lance el supervisor en el mismo
  repositorio recibe un mensaje claro en vez de una carrera silenciosa.
- El estado durable necesita un campo más. Es un cambio compatible: un journal
  viejo se lee igual y se considera «sin conductor» hasta que alguien actúe.

## Relación con el resto

- **ADR-001** (kit v0.2) decía «sin hooks, MCP ni daemon». Quedó sustituido
  por la evolución real del producto; véase ADR-003.
- **ADR-003** delimita el alcance del servidor de herramientas para que no
  entre en la categoría de «orquestar el ciclo» que el kit descartaba.
