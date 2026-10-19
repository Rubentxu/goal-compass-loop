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

## Como se usa

1. Registra el plugin:

   ```
   mcode plugin add goal-compass -m local
   ```

2. En el repositorio donde quieras encadenar objetivos, crea `goal-compass.json`
   con la declaracion de la mision:

   ```json
   {
     "missionId": "mi-mision",
     "objective": "Que busca la mision",
     "backlog": [
       {
         "candidateId": "primer-trabajo",
         "objective": "Que hay que hacer primero",
         "whyNow": "Por que ahora",
         "evidenceRefs": ["docs/EVIDENCIA.md"],
         "doneWhen": ["Como se sabe que esta hecho"],
         "risk": "low",
         "priority": 10,
         "source": "roadmap"
       }
     ]
   }
   ```

   El `workspace` se toma del sitio donde vive el fichero, asi que no hace
   falta escribirlo. Si se escribe, manda el del fichero.

3. Abre una sesion de MCode en ese repositorio. El hook entra en juego en cada
   cierre de turno.

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
