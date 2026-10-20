# El ciclo explicado (para quien llega nuevo)

Este documento no asume que sepas nada del proyecto. Explica qué hace el
sistema, qué se ha hecho en este ciclo y cómo se usa.

---

## 1. El problema que resuelve

MCode sabe ejecutar **un** objetivo (`/goal`) muy bien. Pero cuando ese objetivo
se termina, la cadena se para: hay que escribir otro comando a mano para
seguir.

Lo que aquí se ha construido es el **eslabón que falta**: algo que, cuando un
objetivo termina, decide cuál es el siguiente y lo lanza, sin que nadie toque
el teclado.

```
Misión: "mejorar y estabilizar este proyecto"     <- dura días o semanas
   |
   +--> Objetivo 1: corregir un fallo              <- se completa y se verifica
          |
          +--> se decide el siguiente trabajo
                 |
                 +--> Objetivo 2: implementar una mejora
                        |
                        +--> Objetivo 3: validar la integración
                               |
                               +--> se vuelve a decidir...
```

La **misión** es la intención de largo plazo. Los **objetivos** son las unidad
de trabajo: pequeños, verificables, y se hacen de verdad. Que un objetivo se
complete no significa que la misión se haya acabado.

## 2. Las tres piezas y por qué son tres

Hay una limitación en el propio MCode: el modelo **no puede crear otro
objetivo**. Solo puede leer el actual y marcarlo como terminado. Crear el
siguiente es una acción que hace el programa, no el modelo.

Por eso el sistema tiene tres piezas con responsabilidades distintas:

| Pieza | Dónde vive | Qué hace |
|---|---|---|
| **La skill** | `skill/goal-compass/` | Decide *cómo* se trabaja dentro de un objetivo: investigar, diagnosticar, planear, implementar, verificar, desbloquear. Es un mapa de 12 nodos con el que el agente navega. |
| **El supervisor** | `src/` | Es el único que puede crear objetivos. Observa, decide el siguiente, lo lanza y comprueba que salió bien. |
| **El servidor de herramientas** | `src/plugin/mcp-server.ts` | Le da al agente cinco herramientas para mirar la misión, proponer trabajo y mandarle órdenes sin salir de la conversación. |

Instalar solo la skill **no** encadena objetivos. Instalar solo el supervisor
**no** gobierna cómo se trabaja. Las dos juntas, sí.

Y hay un detalle importante en el reparto: **solo el supervisor crea
objetivos**. Las herramientas no crean nada; proponen. El trabajo de encadenar
sigue estando en un único sitio, que es lo que evita que dos cosas decidan a
la vez.

## 3. Qué pasó en este ciclo

### 3.1 Se convirtió en un plugin de MCode

Hasta ahora esto era un programa que había que lanzar y vigilar. Ahora es un
**plugin de MCode**, y eso cambia dónde ocurre el trabajo.

Un plugin de MCode puede llevar:

- una **skill**, que el agente carga cuando le hace falta;
- un **hook**, un programa que el host ejecuta en un momento concreto.

El momento concreto que faltaba era el **cierre de turno**: cuando el agente
termina de responder, el host avisa, el hook comprueba cómo ha quedado el
objetivo en curso y, si está terminado, **crea el siguiente en esa misma
sesión** y devuelve el turno al agente para que siga trabajando.

La diferencia con el supervisor en segundo plano es de fondo: el supervisor
trabaja en una sesión propia, en su propio host; el plugin trabaja **en la
sesión del usuario**, en su propio host. Nadie tiene que vigilar nada, y no
hay un procesoviviendo entre turno y turno.

Para que el plugin pudiera entregarse tal cual, hubo que quitarle una
dependencia: el transporte ACP (el protocolo con el que se habla con el
programa de MCode) está ahora escrito sobre la biblioteca estándar de Node.
El paquete que se instala no necesita `npm install` ni ningún paso previo.

### 3.2 Se verificó el contrato contra el programa real

Antes de escribir nada se comprobó qué ofrece realmente el programa instalado
(la versión 0.6.12), no lo que dice la documentación. Resultado: los métodos
para crear, leer, cambiar y borrar objetivos existen y funcionan, y **el
objetivo se ejecuta solo** en cuanto se crea, sin necesidad de lanzarlo a mano.

Eso cambió el diseño: el supervisor no necesita "empujar" al objetivo para que
trabaje. Solo necesita observar y crear el siguiente.

En este ciclo se comprobó además otra cosa, que es la que hace posible el
plugin: **dos clientes pueden hablar de la misma sesión**. Un segundo cliente
puede leer el objetivo de una sesión que no es suya e, incluso, crear el
siguiente cuando no hay ninguno activo. Es lo que permite que el hook
encadene el trabajo **en la sesión del usuario**.

### 3.3 Se mejoró la calidad del código

- **Núcleo puro separado de los efectos.** Un archivo decide *qué* hacer sin
  tocar disco ni red; otro lo ejecuta. Eso permite probar la lógica completa
  en milisegundos, sin montar un programa real.
- **Un solo puerto de candidatos.** Antes había tres clases casi iguales; ahora
  se componen. Añadir una fuente de trabajo nuevo es una línea, no un refactor.
- **Despacho de comandos por tabla.** La interfaz de línea de comandos dejó de
  ser una cadena de `switch` para ser una tabla de handlers.
- **Comentarios limpios.** Se han quitado del código las referencias a
  documentos, hitos y nombres propios. Ahora un comentario explica qué hace el
  código y por qué, y nada más.

### 3.4 Se añadió descubrimiento de trabajo (lo que faltaba de verdad)

Antes, el supervisor solo podía encadenar objetivos que alguien hubiera
escrito a mano en el fichero de misión. Ahora el trabajo sale de **tres
fuentes**, en este orden:

1. **Backlog curado** — lo que el usuario declaró como prioritario. Manda aquí.
2. **Evidencias del repositorio** — pendientes marcados en el código (`TODO`,
   `FIXME`, `XXX`, `HACK`) y pruebas omitidas (`it.skip`, `xit`, `todo`), con
   su ubicación exacta (`fichero:línea`).
3. **Exploración acotada** — cuando las dos anteriores no ofrecen nada, se
   puede pedir al agente del host una propuesta de trabajo.

La tercera tiene un candado importante: **la evidencia tiene que señalar a un
fichero que exista de verdad**. Una propuesta sobre un fichero inexistente se
descarta sola. Eso es lo que impide el trabajo inventado, que era el riesgo
evidente de dejar que un modelo proponga tareas.

La exploración también es acotada en el tiempo: una consulta por enfriamiento, y
cada consulta vacía duplica la espera siguiente. Preguntar una y otra vez lo
mismo sería gastar sin obtener nada.

### 3.5 Se dejó de colgar en silencio

Un objetivo bloqueado, o uno que simplemente se queda quieto, dejaba la misión
esperando sin que nada dijera que algo iba mal. Ahora se vigila la **firma** del
objetivo (su estado, sus turnos y sus tokens) y, si no cambia durante el margen
configurado, la misión queda dormida **con el motivo escrito a la vista**.

Importa distinguir "no avanza" de "tarda": un objetivo que está trabajando
cambia de turnos o de tokens, así que no se marca por el mero paso del tiempo.

### 3.6 Se añadió operación sostenible

- **Presupuesto de misión.** Se puede fijar un límite de tokens para *toda* la
  misión. Al agotarlo, la cadena se detiene sola en vez de gastar sin fin.
- **Parada útil.** Cuando pones la misión en pausa, el objetivo en curso también
  se pausa: deja de consumir. Al continuar, se reanuda. Antes la orden del
  usuario tardaba en aplicarse y el trabajo seguía gastando mientras tanto.
- **Reconexión.** Si el programa que hospeda el objetivo se cae, el supervisor
  lo vuelve a levantar, reanuda la misma sesión y sigue. El objetivo vive en el
  almacenamiento del programa, así que no se pierde.
- **Errores acotados.** Un fallo repetido no dispara un bucle infinito: tras
  varios intentos seguidos la cadena se detiene y avisa.

### 3.7 Se mejoró el arnés de pruebas

Antes había cuatro scripts sueltos, cada uno con su propio montaje. Ahora hay
**un arnés compartido** con un único fichero de escenarios:

| Antes | Ahora |
|---|---|
| 4 scripts independientes | 1 arnés + 4 escenarios |
| Montaje repetido en cada uno | Montaje en un solo sitio |
| Esperas fijas por tiempo | Espera por **condición observable** (el estado real) |
| Recibos con formatos distintos | Un único formato de recibo |

Los dos scripts que solo servían para *explorar* el programa (probar que los
métodos existían, ver que el objetivo se autoejecuta) se han retirado: su
función vive ahora en el comando `goal-compass probe` y en las pruebas
permanentes, así que no hacía falta mantenerlos.

### 3.8 El agente por fin puede ver la misión

Hasta ahora el agente era ciego con respecto a la misión: sabía que había un
objetivo en curso porque el programa se lo decía, pero **no podía mirar el
estado ni综合治理**. Preguntar el estado de la misión era cosa de una
terminal, fuera de la conversación.

El plugin ahora entrega un **servidor de herramientas**: cinco funciones que
el agente puede invocar por su nombre, igual que invoca cualquier otra
herramienta.

| Herramienta | Qué hace |
|---|---|
| `mission_status` | En qué está la misión, cuántos objetivos ha encadenado y qué trabajo hay disponible ahora mismo |
| `mission_propose` | Propone el siguiente objetivo |
| `mission_pause` | Pausa la cadena y el objetivo en curso |
| `mission_resume` | Reanuda una misión pausada o dormida |
| `mission_stop` | Termina la cadena |

La que más explica el diseño es `mission_propose`. Cuando el agente llega a un
punto sin trabajo obvio, **no decide** el siguiente objetivo: lo **propone**,
con la evidencia que ha encontrado. La propuesta se guarda en un fichero aparte
y, en el siguiente cierre de turno, es el hook quien la encadena si sigue
siendo válida.

Y aquí está el candado, que es lo mismo que ya se usaba para la exploración:
**la evidencia tiene que señalar a un fichero que exista de verdad**. Si el
agente propone "arreglar el parseo" señalando un fichero que no está en el
repositorio, la propuesta se descarta sin más. Sin esa regla, una herramienta
que deja proponer trabajo sería una puerta abierta a inventar tareas.

Hay una segunda regla, más sutil: **el servidor de herramientas no escribe en el
journal**. El journal —el registro donde vive la verdad de la misión— lo sigue
escribiendo solo quien encadena objetivos. Las órdenes y las propuestas van a
ficheros aparte, precisamente para que dos procesos no se pisen. Por eso el
sistema puede tener a la vez al agente hablando con la misión y al hook
encadenando trabajo.

### 3.9 Fallos que costaron encontrar

Los dos primeros aparecieron de la misma manera: **el plugin desaparecía sin
decir nada**.

El primero era el icono: el manifiesto de MCode lo exige, y sin él el paquete
se descarta antes de llegar al catálogo. El segundo fue la entrada del
servidor de herramientas: en el modo oficial tiene que declarar `"type":
"stdio"`, y sin esa línea el host no sabe cómo hablar con el servidor y
descarta el paquete igual. En los dos casos, el listado de plugins no
mostraba ningún error: el marketplace parecía simplemente vacío.

El tercero no era del plugin, sino del host: **arranca el servidor de
herramientas desde su propia carpeta**, no desde el proyecto. El directorio de
trabajo del proceso no dice nada del proyecto; lo que sí lo dice es una
variable del entorno. Por eso la búsqueda de la misión se hace por el
entorno, y además **sube por los ancestros**: si el agente está en un
subdirectorio, la misión se sigue encontrando.

La lección que se repite: cuando algo desaparece sin error, lo primero que hay
que hacer es **mirar el sitio donde se decide que no existe**, no el sitio
donde se usa.

Y hay un cuarto, que no es del plugin sino del host: un día el programa dejó de
arrancar con `agent_name_conflict_migration_failed:lock`. Resultó ser un
**candado huérfano** de un proceso interrumpido, sobre la carpeta de datos
entera. Cuando el host falla así, de golpe y en varios comandos a la vez, no
hay que buscar el fallo en el código propio: hay que mirar el directorio de
datos y comprobar si el candado está vivo. Si su marca de tiempo no se mueve,
está huérfano y se puede retirar.

### 3.10 Lo que el sistema promete tiene que ser verdad

Este ciclo no ha añadido capacidades: ha **arreglado promesas que no se
cumplían**. Y encontró tres, que son el mismo tipo de problema.

**La primera: una herramienta que prometía un trabajo que se perdía.** Cuando
el agente proponía el siguiente objetivo, la herramienta contestaba
"Propuestas utilizables: 1. Se encadenará en el próximo cierre de turno." Pero
la propuesta **nunca se encadenaba**: el motor descarta todo trabajo que no
diga cómo se sabrá que está hecho, y ese dato era opcional en la herramienta.
El agente veía un mensaje de éxito y su trabajo se perdía en silencio.

Es exactamente el fallo que el sistema existe para evitar, pero probado al revés:
en vez de inventar trabajo, lo **descartaba sin decirlo**.

El arreglo tiene dos partes, y las dos importan:

- La herramienta **exige** el criterio de cierre y, si falta, explica por qué
  y no registra nada. Fallar pronto y con el motivo es mejor que prometer.
- La regla de "qué es trabajo" vive **en un solo sitio**, en el motor, y la
  usan tanto el motor como el canal de propuestas. Antes cada uno tenía su
  propia idea y por eso se contradecían.

**La segunda: el arnés probaba otro sistema.** Los escenarios de aceptación
montaban su propia lista de fuentes de trabajo, y esa lista no era la que usa
el producto: le faltaba el canal de propuestas. Es decir, la mitad de lo que
el sistema hace no lo probaba nadie, y el arnés podía dar verde mientras el
producto fallaba.

Ahora hay **un solo lugar** que decide de dónde sale el trabajo, y lo usan
las dos partes. Cuando esto se rompa, se rompe en los dos sitios a la vez, y
se ve.

**La tercera: la skill que se entrega no la comprobaba nadie.** El kit de
especificación traía un comprobador de la forma del grafo, pero miraba **una
copia congelada** de la skill, no la que se instala. La skill de verdad ya
había cambiado en cuatro ficheros y nadie se enteraba. La comprobación era
teatro: comprobaba algo que nadie usa.

Ahora el grafo que se instala tiene contrato en la suite permanente: cada nodo
tiene su forma, cada enlace apunta a un nodo que existe, se puede llegar a
todos los nodos y se puede salir de todos ellos. Y —esto es lo importante—
**se ha probado que el contrato muerde**: rompiendo un enlace a propósito, la
comprobación falla diciendo qué fichero y por qué.

### 3.11 El límite de la misión llega al agente

`allowRemoteWrite` estaba en la configuración de la misión, se guardaba en el
estado durable y **no lo consultaba nadie**. Era una promesa escrita en un
fichero, no un límite.

Ahora el límite viaja en el mensaje que el hook le devuelve al agente al
encadenar un objetivo, porque el agente es el único que puede hacer `push`,
publicar o desplegar. Si la misión no lo autoriza, el agente lo sabe antes de
empezar, no después.

Y se ha quitado por el camino una función exportada que ya no usaba nadie y
un ayudante del arnés que además estaba mal hecho: creaba una carpeta con el
nombre troceado y fallaba al escribir ficheros en subdirectorios.

### 3.12 Y una prueba que se hizo sola

Lo mejor que salió de este ciclo no lo forzamos: **ocurrió**.

Al pedirle al agente del programa que buscara trabajo en un repositorio de
prueba, el agente **usó la herramienta de propuestas del propio plugin** para
dejar su propuesta: con su evidencia, con su motivo y con su criterio de
cierre. Después, el sistema encadenó esa propuesta como objetivo siguiente.

Es el circuito entero, sin que nadie lo orquestara:

```text
agente investiga  ->  agente propone con la herramienta  ->  el sistema encadena
```

Y demuestra, además, que el arreglo de este ciclo era necesario: con el
contrato anterior, ese mismo agente habría registrado un trabajo que se
perdía en silencio. La propuesta traía criterio de cierre, y gracias a eso se
encadenó.

Y salta a la vista algo que conviene entender: **el objetivo lo encadenó el
hook del plugin, no el supervisor**. En la UAT conviven las dos vías de
encadenado, porque el escenario arranca el supervisor y el anfitrión trae el
plugin. No chocan —el journal deduplica por clave estable de candidato y la
creación se confirma con una lectura posterior—, pero la lección es clara: el
plugin y el supervisor son **vías alternativas** de encadenar trabajo, y en una
instalación real hay que elegir una.

### 3.13 Una misión, un conductor

El ciclo anterior lo dejó escrito como una curiosidad: en la UAT había dos
manos encadenando trabajo. Esta vez se ha colocado en su sitio, porque no era
una curiosidad sino un **agujero de diseño**.

El problema, dicho sin rodeos. Hay dos caminos que pueden encadenar objetivos
sobre la misma misión:

- el **supervisor**, que mira en bucle y crea el siguiente cuando el objetivo
  en curso termina;
- el **hook del plugin**, que crea el siguiente cuando el agente cierra el
  turno.

Los dos escriben en el mismo journal y ven el objetivo terminado **en el
mismo instante**: el cierre de turno del agente ocurre justo cuando el
supervisor lo nota en su siguiente sondeo. Sin una regla que los separe, los
dos deciden crear y se crean dos objetivos para el mismo trabajo. Uno se queda
huérfano y sus tokens se pierden.

Lo que el kit de especificación pedía era «un solo escritor». Ese invariante
era cierto para el **fichero**, que se escribe de forma atómica, pero no para
la **decisión**, que es justo lo que se duplica. Y hay una segunda mitad: el
hook reescribía el journal entero en cada cierre de turno, aunque no tuviera
nada que hacer, y eso puede pisar lo que el supervisor acaba de escribir.

La solución tiene cuatro piezas, y las cuatro hacen falta:

1. **La declaración.** El fichero de misión puede decir quién la conduce:
   `"driver": "supervisor"` o `"driver": "plugin"`. Si lo dice, es la ley y el
   otro camino se aparta sin tocar nada.
2. **El mando.** Sin declaración, lo toma el primero que actúa. Es un
   *arrendamiento*: caduca a los cinco minutos, así que un proceso muerto no
   puede dejar la misión atada.
3. **El candado.** Aunque el mando se reparta bien, la ventana de encadenado se
   protege con un candado exclusivo: dos vías no pueden crear a la vez. Y el
   candado también caduca, por el mismo motivo.
4. **Apartarse es no tocar nada.** El camino que no conduce no abre el host, no
   escribe en el journal y no deja el estado a medias. Esto no estaba en el
   diseño inicial, y era el fondo del asunto: antes, «no encadenar» significaba
   «encadenar menos cosas», y el hook seguía abriendo una sesión del host y
   reescribiendo el journal entero en cada cierre de turno. Podía pisar lo que
   el supervisor acababa de escribir.

Y el efecto colateral que más importa: **las pruebas de aceptación ahora pueden
declarar su conductor**, así que miden un solo camino. Antes, con el plugin
instalado, el hook se adelantaba y el escenario `exploration` medía el hook en
vez del supervisor. Ese hueco, que quedó abierto en el ciclo anterior, queda
cerrado.

Y salió de ahí una lección sobre el arnés que merece su propio párrafo,
porque es la segunda vez que ocurre. **El arnés escribía la declaración de la
misión con un nombre que el plugin no busca.** La línea de órdenes usa el
fichero que le indiques; el plugin busca la declaración en el repositorio con
su nombre. Con el nombre equivocado, el hook no se apartaba por la declaración:
sencillamente no encontraba la misión. La prueba pasaba, pero midiendo menos
de lo que parecía. El arreglo es de una línea, y la lección no: **una prueba
que monta las cosas a su manera está probando su manera, no la del producto**.

La lección final: **«un solo escritor» no es una frase sobre ficheros, es una
frase sobre decisiones**. Y una regla que depende del orden de arranque no es
una regla, es una suerte.

### 3.14 El árbol como dato, y la cadena que no se apaga

El ciclo anterior dejó el sistema con un solo conductor. Este ciclo le hace dos
preguntas más: **¿de dónde sale la decisión?** y **¿qué pasa cuando ya no
queda nada que hacer?**

#### Lo que se encontró, con la fuente primaria

`src/core/decide.ts` es el núcleo puro de la decisión, y dice tres cosas que
importan:

1. La misión se aparca en cuatro casos: objetivo estancado, `maxGoals`
   alcanzado, **presupuesto agotado** y **«sin trabajo elegible»**.
2. El siguiente objetivo se elige con un orden **estático**: prioridad, riesgo,
   coste e identificador. El `whyNow` del candidato es texto: no influye.
3. El hook del plugin **no explora** (`exploration: false`): preguntar al
   modelo se come el tiempo del turno.

De ahí sale el hueco que este ciclo cierra: **en la vía del plugin la cadena no
se autoalimenta**. Si el backlog se vacía y nadie propone nada, el hook no
encuentra trabajo, el turno se acaba y la cadena muere con la misión todavía
vivo. Y el objetivo que arranca no lleva nada del contexto del proyecto: el
agente vuelve a deducirlo desde cero en cada turno.

#### El árbol pasa a ser dato

La topología del grafo vivía dentro del texto markdown: cada nodo tenía su
lista de enlaces escrita a mano en la prosa. Eso no se puede validar con
sentido, ni sustituir por proyecto.

Ahora **cada nodo es un markdown con una cabecera YAML**, y la cabecera es la
fuente de la topología:

```yaml
---
id: implement
role: agent
links:
  - to: verify
    rel: next
    when: cambio aplicado
    evidence: comando de prueba preciso
---
```

El cuerpo sigue siendo el prompt. La cabecera dice quién ejecuta el nodo
(`role`), qué salidas tiene y con qué condición se toma cada una. Y como la
topología es dato, se puede **comprobar**: que todo enlace apunte a un nodo que
existe, que todo nodo se alcance desde la entrada, que todo nodo tenga salida y
que un nodo de control solo se entre por `discover` o `await`.

Para leer YAML sin dependencias, el proyecto lleva su propio lector de un
subconjunto acotado: `src/adapters/yaml.ts`. Un lector completo sería una
biblioteca entera; este es lo justo que el árbol necesita, y lo que no admite
se rechaza con un error claro en vez de adivinarse.

#### La respuesta de continuación lleva el contexto

El prompt que el hook entrega al agente al encadenar un objetivo no decía nada
del proyecto. Ahora dice dónde está la misión en ese momento: cuántos
objetivos ha completado, cuál fue el último, cuánto presupuesto queda y cuánto
trabajo declarado sigue pendiente.

Y sobre todo, **pide dejar el trabajo siguiente**: al terminar, el agente
propone con `mission_propose` la evidencia de lo que viene y cómo se sabrá que
está hecho. Eso es lo que cierra el bucle: la cadena se alimenta de la
continuidad del propio trabajo, no de una lista escrita a mano.

#### El árbol propio del proyecto

Un proyecto puede tener su propio árbol en `.goal-compass/`, un subdirectorio
de trabajo que **queda ignorado por git**: es configuración local y no debe
ensuciar el `git status` de quien está trabajando. El comando

```bash
node dist/cli.js tree --workspace /ruta/al/proyecto
```

prepara el directorio, asegura su entrada en `.gitignore` y dice qué árbol se
está siguiendo y si tiene problemas.

#### La lección

**Lo que se decide en un sitio y se aplica en otro, termina siendo dos
sistemas.** El grafo era un ejemplo: la topología la escribía una persona en
prosa y la comprobaba otra persona parseando esa prosa. Al pasar la topología
a la cabecera, la persona sigue escribiendo lo mismo, pero ahora hay un sitio
único y una comprobación que lo entiende.

Y la segunda: **una cadena que se queda sin trabajo no se apaga, se queda
muerta en silencio.** Preguntar al modelo cuesta un turno entero y no cabe en
un hook de nueve segundos; la única forma de que la cadena siga es que quien
trabaja deje lo que viene. Pedirlo no es una formalidad: es el combustible.

### 3.15 La misión se activa con una frase

El plugin estaba instalado en todas las sesiones, la skill estaba disponible, y
aun así **no había forma de empezar**. El hook busca la declaración de la
misión en el proyecto; si no la encuentra, no encadena nada y no dice por qué.
Y la forma de crear esa declaración no estaba escrita en ningún sitio: la skill
explicaba cómo seguir una misión, no cómo empezar una.

Ahora hay una puerta, y da igual por dónde se entre:

```bash
node dist/cli.js declare --workspace /ruta/al/proyecto \
  --objective "Mejorar este proyecto paso a paso"
```

o la herramienta `mission_declare` desde la conversación, o el fichero
`goal-compass.json` a mano. Las tres hacen lo mismo.

La puerta tiene dos reglas que importan más que la puerta:

- **No pisa.** Si ya hay una declaración, la devuelve tal cual. Declarar dos
  veces no rompe nada, y una declaración escrita a mano no se pierde por
  detrás de la herramienta.
- **No inventa el identificador.** Sale del nombre del proyecto y de una
  huella corta de su ruta. El estado durable se guarda por identificador, fuera
  del repositorio: dos proyectos con el mismo identificador se pisarían en
  silencio, y eso ya no puede pasar. Si alguien lo fuerza, el sistema lo dice y
  no conduce.

Con eso, la pregunta «¿puedo usarlo ya en la sesión que tengo abierta?» tiene
respuesta: **sí, con un prompt.** Se declara la misión del proyecto (una vez) y
después:

> Continúa la misión de este repositorio.

El agente carga la skill, comprueba la misión y sigue. Al terminar el turno, el
hook crea el siguiente objetivo en esa misma sesión.

Comprobado con el host real: una sesión de MCode con ese prompt encadenó un
objetivo en la sesión del usuario, y el objetivo nació de una propuesta que
había dejado el propio agente. Después, el agente trabajó en el repositorio:
creó su `package.json`, su módulo y sus pruebas.

#### La lección

**Instalar no es activar.** Entre una cosa y otra hay un paso que, si falta,
hace que todo lo demás parezca que no funciona: el sistema está en su sitio,
pero no tiene nada que hacer y calla. Un paso que se salta sin decir nada es
peor que un paso que no existe, porque hace dudar de lo que sí funciona.

## 4. Cómo se usa

### Con el plugin (lo recomendado)

```bash
npm install
npm run build
node dist/cli.js install-plugin        # ensambla el plugin
mcode plugin add goal-compass -m local # lo registra en MCode
```

Después, en el repositorio donde quieras encadenar, declara la misión. La vía
rápida es un comando:

```bash
node dist/cli.js declare --workspace /ruta/al/proyecto \
  --objective "Mejorar y estabilizar este proyecto"
```

El comando escribe `goal-compass.json`, deja preparado el directorio de trabajo
del proyecto y deriva un identificador de misión distinto para cada proyecto.
No pisa una declaración que ya exista, y declararlo dos veces no rompe nada.

Si prefieres escribirla a mano, el fichero se llama `goal-compass.json` y el
`workspace` se toma del sitio donde vive, así que no hace falta escribirlo:

```json
{
  "missionId": "mi-mision",
  "objective": "Mejorar y estabilizar este proyecto",
  "defaultTokenBudget": 120000,
  "totalTokenBudget": 500000,
  "backlog": [
    {
      "candidateId": "arreglar-el-parseo",
      "objective": "Corregir la pérdida de relaciones al indexar recursos",
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

Abre una sesión de MCode en ese repositorio y pide:

> Continúa la misión de este repositorio.

Cada vez que el agente termina su turno, el hook comprueba el objetivo en curso:
si está terminado, crea el siguiente en esa misma sesión y le devuelve el turno.

Dentro de la conversación, el agente dispone además de las seis herramientas
(`mission_status`, `mission_declare`, `mission_propose`, `mission_pause`,
`mission_resume`, `mission_stop`). Basta con pedirle en voz alta que mire el
estado de la misión, que la pause o que la declare si no existe: el modelo las
invoca por su cuenta.

### Con el supervisor en segundo plano

Se escribe un fichero `mission.json` (fuera del repositorio que se va a
mejorar):

```json
{
  "missionId": "mi-mision",
  "objective": "Mejorar y estabilizar este proyecto",
  "workspace": "/ruta/al/proyecto",
  "defaultTokenBudget": 120000,
  "totalTokenBudget": 500000,
  "maxGoals": null,
  "allowRemoteWrite": false,
  "backlog": [
    {
      "candidateId": "arreglar-el-parseo",
      "objective": "Corregir la pérdida de relaciones al indexar recursos",
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

Lo importante:

- `evidenceRefs` y `doneWhen` **no son opcionales en la práctica**. Un candidato
  sin evidencia o sin criterio de cierre se descarta.
- `defaultTokenBudget` necesita holgura. Medido de verdad: un objetivo trivial
  consume entre 13 000 y 63 000 tokens, y la mayoría se acerca a 63 000 (el
  programa ejecuta un worker *y* un verificador, y los dos gastan). Con 40 000
  el objetivo nunca llegó a completarse. 120 000 vale para un objetivo de un
  turno; si puede necesitar dos, mejor 200 000.
- `totalTokenBudget` es el freno de gasto de la misión entera; al agotarse, la
  cadena se detiene.
- `allowRemoteWrite: false` mantiene el `push`, los despliegues y las
  publicaciones fuera del alcance automático. Requieren autorización explícita.

### Arrancar

```bash
npm install
npm run build

node dist/cli.js init --config ./mission.json   # prepara el estado
node dist/cli.js run  --config ./mission.json   # arranca la cadena
```

A partir de ahí la cadena funciona sola. Para mirarla:

```bash
node dist/cli.js status --mission mi-mision
```

Y para mandarle órdenes:

```bash
node dist/cli.js pause  --mission mi-mision   # detiene el trabajo en curso
node dist/cli.js resume --mission mi-mision   # lo continúa
node dist/cli.js stop   --mission mi-mision   # termina la cadena
```

### Instalar la skill (opcional)

```bash
node dist/cli.js install-skill
```

Se copia a la carpeta de skills del programa. Abre una sesión nueva y
comprueba que aparece en la lista de skills.

## 5. Cómo se comprueba que funciona

Hay dos niveles, y no se mezclan:

**Pruebas permanentes** (`npm test`) — 95 pruebas que corren en menos de tres
segundos. Comprueban la lógica: qué se decide, cuándo se crea un objetivo,
cuándo no, cómo se reconcilia un fallo a medias, cuándo se detecta el
estancamiento y qué propuestas de exploración se aceptan.

Además, tres piezas se prueban contra un **host de mentira que es un proceso
real**, no contra una simulación: el transporte (troceado de mensajes,
emparejamiento de respuestas, ida y vuelta de peticiones, forma de los errores),
el hook del plugin (el objetivo se crea en la sesión del evento, la misión
queda con la intención confirmada, y ni un fallo del host ni la falta de tiempo
rompen el turno) y el servidor de herramientas (las peticiones llegan
emparejadas con su respuesta, una herramienta que no existe se avisa en vez de
fallar en silencio, y una herramienta que se rompe por dentro devuelve el
motivo).

Y hay una cuarta cosa que se comprueba, que no es código sino el mapa que lee
el agente: **la forma del grafo de la skill**. Cada nodo tiene que tener sus
secciones, sus enlaces tienen que apuntar a nodos que existen, y desde
cualquier nodo se tiene que poder llegar a un cierre. Sin esto, un enlace
roto en la skill manda al agente a un sitio inexistente y no hay ninguna
prueba que lo note.

**Escenarios de aceptación** (`npm run uat`) — contra el programa real, con
tiempo límite y recibos. Comprueban la capacidad completa:

| Escenario | Qué demuestra |
|---|---|
| `chain` | Tres objetivos encadenados, sin intervención del usuario entre ellos; el del medio llega por el canal de propuestas y se encadena en su momento. |
| `recovery` | Un fallo entre crear y confirmar se reconcilia sin duplicar. |
| `pause` | La orden de pausa detiene el trabajo en curso y la de continuar lo reanuda. |
| `budget` | Agotado el presupuesto, no se encadena otro objetivo. |
| `exploration` | Sin backlog ni pendientes marcados, la exploración encuentra trabajo real. |

Los escenarios se ejecutan en un directorio temporal que se borra al terminar, y
dejan un recibo con el resultado de cada comprobación. El arnés monta **las
mismas fuentes de trabajo que el producto**, para que los escenarios no
puedan estar probando otro sistema.

Y el recibo tiene **tres estados**, no dos:

| Estado | Qué quiere decir |
|---|---|
| `PASA` | Se comprobó y se cumplió |
| `FALLA` | Se comprobó y no se cumplió |
| `NO CORRIO` | El host dejó el trabajo a medias y no se pudo comprobar |

El tercero importa más de lo que parece. El host puede abortar el verificador
de un objetivo o quedarse sin recursos a mitad de una cadena. Cuando eso pasa,
el sistema ha hecho lo correcto: negarse a encadenar otro objetivo y esperar.
Si el arnés dijera "falló", estaría señalando un problema donde no lo hay, y
la próxima vez nadie miraría ese rojo. Si dijera "pasó", estaría mintiendo
sobre una comprobación que no se hizo. Por eso hay un tercer estado, y por eso
el resumen de la ejecución dice cuántos escenarios se quedaron sin comprobar.

## 6. Lo que el sistema no hace

- **El supervisor no se conecta a una sesión ya abierta.** Gobierna la suya
  propia. El **plugin** sí trabaja en la sesión del usuario, porque recibe su
  identificador en el evento del hook.
- **El plugin no publica nada por su cuenta.** Ni `push`, ni releases, ni
  despliegues.
- **No inventa trabajo.** Sin evidencia en el backlog o en el repositorio, la
  misión se duerme. Esto incluye las propuestas del agente: una propuesta sin
  fichero real detrás se descarta.
- **No sortea los límites.** Si el objetivo se queda sin presupuesto o sin
  cuota, la cadena para; no crea otro objetivo para esquivarlo.
- **El servidor de herramientas no crea objetivos.** Solo propone y da órdenes;
  el cierre de turno es quien encadena.
