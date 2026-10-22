# ADR-006 · La declaración es la puerta, y su identificador se deriva

**Estado:** aceptado · **Fecha:** 2026-10-22 · **Sustituye a:** la identidad de
misión escrita a mano en un fichero de configuración que podía vivir en
cualquier sitio

## Contexto

Una misión es «un objetivo con continuidad»: encadena Goals, guarda su
estado y lo retoma. Para que eso exista hace falta responder a dos
preguntas, y las dos tienen una respuesta fácil de dar mal:

1. **¿Qué es una misión?** Si el identificador lo escribe quien la
   declara, el mismo repositorio puede acabar con dos misiones —«mision» y
   «mi-mision»— y por tanto con dos journals, dos cadenas y dos conjuntos
   de tokens gastando en el mismo trabajo. Nada avisa: las dos misiones son
   válidas por separado.
2. **¿Dónde vive?** Si la declaración es un fichero de configuración que
   se pasa por ruta, la misión se desliga del proyecto sobre el que
   trabaja. Dos rutas al mismo directorio son dos misiones distintas, y la
   misión puede acabar guardando su estado lejos del proyecto que la
   originó.

El kit v0.2 ya pedía «identificador derivado», pero el producto no lo
cumplía: el identificador era un campo más del fichero, escrito a mano.

## Decisión

**La declaración es un fichero dentro del workspace, y su identificador se
deriva del workspace.**

1. **La puerta.** La misión se declara en el proyecto: `goal-compass.json`,
   junto al trabajo que va a hacer. `declare` la escribe y es **idempotente**:
   si ya hay una declaración, no la toca y devuelve la que hay. Un agente
   que declara dos veces por error no rompe nada, y una declaración escrita
   a mano nunca se pierde por detrás de la herramienta.
2. **El identificador derivado.** Cuando el identificador no se da, se
   deriva del workspace: el nombre del directorio normalizado más cuatro
   hexadecimales del SHA-256 de su ruta absoluta
   (`defaultMissionId`). El mismo directorio da **siempre** la misma
   misión, y dos directorios distintos nunca se confunden —aunque se
   llamen igual—.
3. **El identificador explícito manda.** Se puede escribir a mano cuando
   hace falta, y entonces es el que manda. Es la excepción, no la regla.
4. **El estado que ya hay es de este proyecto.** El estado durable vive
   fuera del repositorio, en una carpeta que se nombra con el identificador.
   Al abrir la misión se comprueba que ese estado sea de este workspace: si
   pertenece a otro proyecto, esta misión **no conduce** y dice por qué, en
   vez de pisar el estado del otro en silencio.

## Alternativas descartadas

- **Identificador libre, escrito a mano:** dos declaraciones del mismo
  repositorio son dos misiones. Se descartó porque el fallo es invisible:
  ambas funcionan, y el gasto se duplica sin que nada lo diga.
- **Configuración en cualquier ruta, pasada por línea de órdenes:** la
  misión se desligaba del proyecto y el mismo trabajo se podía explosionar
  en varios sitios. Se descartó por el mismo motivo: el identificador
  tenía que salir del lugar del trabajo, no de un argumento.
- **Identificador por fecha o aleatorio:** hace imposible reconocer la
  misión de un vistazo y no evita la duplicación; solo la esconde.
- **Sin identificador, solo la ruta:** dos copias del mismo repositorio en
  dos rutas distintas serían la misma misión, con el mismo journal y el
  mismo estado. Se descartó porque el estado es de la copia, no de la
  plantilla.

## Consecuencias

- Declarar dos veces el mismo proyecto es **idempotente**: sale la misma
  misión, no dos.
- `goal-compass status` se puede llamar con el identificador derivado, sin
  que nadie lo apunte antes.
- El estado durable, que vive fuera del repositorio, queda indexado por
  algo que se puede reconstruir desde el directorio: si se pierde el
  journal, se sabe de qué misión era.
- El identificador derivado es corto pero no opaco: el slug se lee y la
  huella desambigua.
- El camino heredado (`init --config`, `run --config`) sigue exigiendo el
  `missionId` del fichero: preparar o arrancar el estado durable de una
  misión **ya declarada** no es declarar una misión.

## Qué fixture deja de ser válido

**La identidad escrita a mano en un fichero de configuración suelto.** El
fixture viejo es `examples/mission.json`: un `missionId` puesto a dedo
(`"ejemplo-mision"`), un `workspace` puesto a dedo y un fichero que se
puede pasar por `--config` desde cualquier ruta. Ese fixture queda
sustituido por la declaración dentro del workspace con identificador
derivado.

Con el fixture viejo la identidad no sale del trabajo: dos ficheros para el
mismo repositorio son dos misiones con dos journals, y el mismo
`missionId` copiado a otro proyecto reparte el estado entre los dos. Con
el contrato nuevo la identidad es una función del workspace: el mismo
directorio da siempre la misma misión, y dos directorios distintos nunca
se confunden.

`init --config` y `run --config` siguen existiendo: lo que queda
invalidado es que ese fichero **sea** la declaración de una misión, no la
herramienta. Poner el ejemplo al día queda pendiente (roadmap p5).

## Relación con el resto

- **ADR-002** (una misión, un conductor) reparte el mando de la misma
  misión entre el supervisor y el plugin. Esta decide **qué** es una
  misión, para que ese reparto sea sobre una sola cosa.
- **ADR-005** (el árbol como dato) decide con qué señal se abre un nodo;
  esta decide qué misión esa señal pertenece.
