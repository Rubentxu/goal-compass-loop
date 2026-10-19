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

## 2. Las dos piezas y por qué son dos

Hay una limitación en el propio MCode: el modelo **no puede crear otro
objetivo**. Solo puede leer el actual y marcarlo como terminado. Crear el
siguiente es una acción que hace el programa, no el modelo.

Por eso el sistema tiene dos piezas con responsabilidades distintas:

| Pieza | Dónde vive | Qué hace |
|---|---|---|
| **La skill** | `skill/goal-compass/` | Decide *cómo* se trabaja dentro de un objetivo: investigar, diagnosticar, planear, implementar, verificar, desbloquear. Es un mapa de 12 nodos con el que el agente navega. |
| **El supervisor** | `src/` | Es el único que puede crear objetivos. Observa, decide el siguiente, lo lanza y comprueba que salió bien. |

Instalar solo la skill **no** encadena objetivos. Instalar solo el supervisor
**no** gobierna cómo se trabaja. Las dos juntas, sí.

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

## 4. Cómo se usa

### Con el plugin (lo recomendado)

```bash
npm install
npm run build
node dist/cli.js install-plugin        # ensambla el plugin
mcode plugin add goal-compass -m local # lo registra en MCode
```

Después, en el repositorio donde quieras encadenar, crea `goal-compass.json`.
El `workspace` se toma del sitio donde vive el fichero, así que no hace falta
escribirlo:

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

Abre una sesión de MCode en ese repositorio y ya está. Cada vez que el agente
termina su turno, el hook comprueba el objetivo en curso: si está terminado,
crea el siguiente en esa misma sesión y le devuelve el turno.

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

**Pruebas permanentes** (`npm test`) — 74 pruebas que corren en menos de tres
segundos. Comprueban la lógica: qué se decide, cuándo se crea un objetivo,
cuándo no, cómo se reconcilia un fallo a medias, cuándo se detecta el
estancamiento y qué propuestas de exploración se aceptan.

Además, dos piezas se prueban contra un **host de mentira que es un proceso
real**, no contra una simulación: el transporte (troceado de mensajes,
emparejamiento de respuestas, ida y vuelta de peticiones, forma de los errores)
y el hook del plugin (el objetivo se crea en la sesión del evento, la misión
queda con la intención confirmada, y ni un fallo del host ni la falta de tiempo
rompen el turno).

**Escenarios de aceptación** (`npm run uat`) — contra el programa real, con
tiempo límite y recibos. Comprueban la capacidad completa:

| Escenario | Qué demuestra |
|---|---|
| `chain` | Tres objetivos encadenados, sin intervención del usuario entre ellos. |
| `recovery` | Un fallo entre crear y confirmar se reconcilia sin duplicar. |
| `pause` | La orden de pausa detiene el trabajo en curso y la de continuar lo reanuda. |
| `budget` | Agotado el presupuesto, no se encadena otro objetivo. |
| `exploration` | Sin backlog ni pendientes marcados, la exploración encuentra trabajo real. |

Los escenarios se ejecutan en un directorio temporal que se borra al terminar, y
dejan un recibo con el resultado de cada comprobación.

## 6. Lo que el sistema no hace

- **El supervisor no se conecta a una sesión ya abierta.** Gobierna la suya
  propia. El **plugin** sí trabaja en la sesión del usuario, porque recibe su
  identificador en el evento del hook.
- **El plugin no publica nada por su cuenta.** Ni `push`, ni releases, ni
  despliegues.
- **No inventa trabajo.** Sin evidencia en el backlog o en el repositorio, la
  misión se duerme.
- **No sortea los límites.** Si el objetivo se queda sin presupuesto o sin
  cuota, la cadena para; no crea otro objetivo para esquivarlo.
- **El plugin no expone un servidor de herramientas.** El agente no consulta el
  estado de la misión con una herramienta: se mira desde fuera, con
  `goal-compass status`. Es la ampliación natural del siguiente ciclo.
