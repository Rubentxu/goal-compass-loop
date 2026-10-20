# Goal Compass · plugin de MCode

Encadena objetivos nativos de MCode dentro de una mision continua. Cuando el
objetivo en curso termina, el plugin crea el siguiente **en la misma sesion en
la que esta trabajando el agente** y devuelve el turno al agente para que siga.

No hay un proceso de fondo esperando: el propio cierre de turno del agente es
el latido de la mision.

## Que lleva dentro

- **La skill `goal-compass`**: el grafo de decision que guia al agente dentro
  de un objetivo. Solo se lee `graph/index.md` y el nodo que corresponda.
- **El hook `Stop`**: cuando el agente termina su turno, comprueba el estado
  del objetivo en curso. Si esta terminado, decide cual es el siguiente
  trabajo util, crea el objetivo siguiente y devuelve un aviso para que el
  turno continue.
- **Un servidor de herramientas**: seis herramientas para que el agente
  pueda mirar la mision y gobiernarla sin salir de la conversacion.

## Las herramientas

| Herramienta | Que hace |
|---|---|
| `mission_status` | En que esta la mision, cuantos objetivos ha encadenado y que trabajo hay disponible. |
| `mission_declare` | Declara la mision del proyecto cuando no existe. Si ya existe, no la toca. |
| `mission_propose` | Propone el siguiente objetivo. La evidencia tiene que senalar a un fichero que exista. |
| `mission_pause` | Pausa la cadena y el objetivo en curso. |
| `mission_resume` | Reanuda una mision pausada o dormida. |
| `mission_stop` | Termina la cadena. |

La propuesta es el camino para cuando no hay trabajo marcado: el agente
investiga, propone con su evidencia, y el cierre de turno siguiente lo
encadena. Una propuesta sobre un fichero que no existe se descarta, asi que
llenar la cola de inventos no sirve de nada.

## Como se usa

1. Registra el plugin:

   ```
   mcode plugin add goal-compass -m local
   ```

2. En el repositorio donde quieras encadenar objetivos, declara la mision. La
   via rapida es un comando:

   ```
   node ~/.minimax/plugins/goal-compass/dist/cli.js declare --workspace /ruta/al/proyecto \
     --objective "Que busca la mision"
   ```

   El comando escribe `goal-compass.json`, deja preparado el directorio de
   trabajo y deriva un identificador distinto para cada proyecto. Si prefieres
   escribirla a mano, el fichero se llama `goal-compass.json` y el `workspace`
   se toma del sitio donde vive, asi que no hace falta escribirlo:

   ```json
   {
     "missionId": "mi-mision",
     "objective": "Que busca la mision",
     "backlog": [
       {
         "candidateId": "primer-trabajo",
         "objective": "Que hay que hacer primero",
         "whyNow": "Por que ahora",
         "evidenceRefs": ["docs/notas.md"],
         "doneWhen": ["Como se sabe que esta hecho"],
         "risk": "low",
         "priority": 10,
         "source": "roadmap"
       }
     ]
   }
   ```

3. Abre una sesion de MCode en ese repositorio y pide: "continua la mision de
   este repositorio". El hook entra en juego en cada cierre de turno.

## Que decide el hook

- Solo un objetivo **terminado** habilita encadenar. Uno activo, pausado o
  bloqueado se deja como esta.
- El siguiente trabajo sale del backlog declarado y, si el backlog se agota,
  de las senales del propio repositorio: pendientes marcados y pruebas
  omitidas.
- El presupuesto de la mision manda: cuando se agota, la mision se duerme sin
  crear nada.
- Si algo falla, el turno continua igual. Un plugin nunca deja al usuario sin
  respuesta por un problema propio.

## Donde vive el estado

El estado durable de la mision esta fuera del repositorio, en
`~/.local/state/goal-compass/<mission-id>/journal.json`. El repositorio solo
guarda la declaracion de la mision.

## Debe

El hook se ejecuta con Node y no necesita instalar nada: el paquete se
entrega con el supervisor ya compilado.
