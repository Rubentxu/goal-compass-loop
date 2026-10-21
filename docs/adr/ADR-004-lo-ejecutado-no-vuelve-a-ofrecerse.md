# ADR-004 · Lo ya ejecutado no vuelve a ofrecerse como trabajo

**Estado:** aceptado · **Fecha:** 2026-10-21 · **Delimita:** quién es la
memoria de lo que una misión ya hizo, y qué se hace con una propuesta que
repite trabajo pagado

## Contexto

Una misión se declara en un fichero: qué objetivo tiene y qué backlog tiene.
Con los ciclos, ese mismo workspace necesita recordar **qué se hizo**, porque
la cadena no puede volver a ofrecer trabajo que ya está pagado.

Había dos memorias y ninguna completa:

| Memoria | Qué sabe | Qué se le escapaba |
|---|---|---|
| El estado interno de la cadena | Las intenciones que ella misma encadenó | El trabajo que se hizo sin que la cadena lo encadenara |
| El workspace | Nada: no había sitio donde anotarlo | Todo |

El efecto era visible en el estado de una misión real: de diez propuestas
disponibles, **siete eran trabajo ya ejecutado**. La cadena podía volver a
encadenar un objetivo que ya estaba pagado, y el agente que leía el estado
veía un menú de trabajo donde solo tres ítems eran nuevos.

El detalle que lo hacía engañoso es que la cadena **sí** sabe deduplicar:
descarta por clave estable un candidato cuyo trabajo ya está completado. Pero
esa clave solo se conoce para las intenciones que la propia cadena encadenó, y
el caso frecuente es justo el contrario: trabajo hecho en un ciclo anterior,
que alguien encadenó a mano o que la cadena encadenó en otra misión.

## Decisión

**El fichero de la misión declara también lo que ya se hizo, y la cadena no
ofrece nada que esté ahí.**

- El fichero de misión admite una lista opcional `executed`: qué objetivo se
  hizo, con qué identificador y con qué recibo.
- El backlog y las propuestas se filtran contra esa lista antes de ofrecerse.
- `mission_propose` **rechaza** una propuesta cuyo objetivo ya se ejecutó: una
  propuesta es trabajo futuro, y registrar lo pasado como si fuera futuro es
  la forma de que la cadena lo encadene otra vez.
- La comparación es por **intención normalizada** (mayúsculas y espacios no
  cuentan), no por texto exacto: el mismo trabajo escrito con otras palabras es
  el mismo trabajo.

Las dos memorias se suman, no se eligieron una: lo que dice el fichero de la
misión (memoria del proyecto) más las intenciones ya confirmadas del estado
interno (memoria de la cadena). Ninguna de las dos basta sola.

## La identidad de un trabajo es su intención

Al arreglar lo anterior apareció un caso vecino: el mismo trabajo llegaba por
dos canales (el backlog curado y una propuesta) y aparecía dos veces en el
menú de trabajo, con atributos distintos. Dos entradas para una sola cosa
hacen que el menú no se pueda leer como una lista.

La regla que lo resuelve es una sola, y es la misma que decide qué está
hecho: **un trabajo se identifica por su intención, el texto de su
objetivo**. El alcance y el criterio de cierre son atributos de la entrada, no
su identidad. Por eso:

- Dos entradas con la misma intención se funden en una y se conserva la del
  canal curado, que es la que alguien ha cuidado.
- Un trabajo ya ejecutado se reconoce aunque su entrada cambiara de atributos.

Consecuencia de fondo: la clave estable que ya usaba el núcleo (intención,
alcance y criterio) sirve para reconocer *la misma entrada*, y la intención
sirve para reconocer *el mismo trabajo*. Son dos preguntas distintas y ahora
tienen dos respuestas distintas.

Si el fichero no trae `executed`, el comportamiento es el de siempre: el
ledger es opcional y su ausencia no descarta trabajo.

## Alternativas descartadas

- **Borrar la propuesta del fichero cuando se ejecuta:** pierde el rastro y no
  sobrevive a que la misma intención se vuelva a proponer con otra redacción.
  Además, el fichero de propuestas es de otro canal y el servidor de
  herramientas no escribe en el journal.
- **Fiarse solo de la clave estable del estado interno:** es la deduplicación
  que ya existía, y su cobertura es exactamente la del problema: solo conoce
  lo que la cadena encadenó.
- **Comparar por identificador de candidato:** las propuestas reciben un
  identificador derivado de su texto, y el backlog puede reescribirse; el
  identificador no sobrevive a la reescritura, la intención sí.
- **Que el servidor de herramientas escribiera el ledger al encadenar:** el
  servidor gobierna la misión, no la conduce; escribir el estado de ejecución
  desde allí rompería el «un solo escritor».
- **Fusionar por la clave estable (intención, alcance y criterio):** el mismo
  trabajo puede llegar con atributos distintos —una propuesta no conoce el
  alcance que le dio el backlog—, y con esa clave las dos entradas no se
  reconocen como la misma cosa. La clave sigue sirviendo para reconocer la
  misma entrada; para el trabajo, la intención.

## Consecuencias

- El fichero de misión crece con un campo opcional. Un workspace que no lo
  use sigue funcionando igual.
- Quien mantiene la misión tiene que anotar lo que se hizo: es la memoria del
  proyecto y no la de la cadena.
- El estado de la misión dice cuántos objetivos están ya ejecutados, para que
  el menu de trabajo se pueda leer sin tener que cruzar dos sitios.
- Una propuesta rechazada por estar ya ejecutada se puede volver a proponer
  con más detalle, y entonces sí se registra.
