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

### 3.1 Se verificó el contrato contra el programa real

Antes de escribir nada se comprobó qué ofrece realmente el programa instalado
(la versión 0.6.12), no lo que dice la documentación. Resultado: los métodos
para crear, leer, cambiar y borrar objetivos existen y funcionan, y **el
objetivo se ejecuta solo** en cuanto se crea, sin necesidad de lanzarlo a mano.

Eso cambió el diseño: el supervisor no necesita "empujar" al objetivo para que
trabaje. Solo necesita observar y crear el siguiente.

### 3.2 Se mejoró la calidad del código

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

### 3.3 Se añadió descubrimiento de trabajo (lo que faltaba de verdad)

Antes, el supervisor solo podía encadenar objetivos que alguien hubiera
escrito a mano en el fichero de misión. Ahora también **lee el propio
repositorio**:

- Detecta **pendientes marcados** en el código (`TODO`, `FIXME`, `XXX`,
  `HACK`) y sabe exactamente en qué fichero y línea están.
- Detecta **pruebas omitidas** (`it.skip`, `xit`, `todo`).
- Convierte cada señal en un objetivo con criterio de cierre comprobable
  ("el pendiente de `src/parser.ts:42` deja de estar marcado").

Sin evidencia no hay candidato. Si el repositorio está limpio, no se inventa
nada: la misión se queda dormida.

### 3.4 Se añadió operación sostenible

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

### 3.5 Se mejoró el arnés de pruebas

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

### Preparar la misión

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
- `totalTokenBudget` es el freno de gasto de la misión entera.
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

**Pruebas permanentes** (`npm test`) — 43 pruebas que corren en menos de un
segundo, sin programa real. Comprueban la lógica: qué se decide, cuándo se
crea un objetivo, cuándo no, cómo se reconcilia un fallo a medias.

**Escenarios de aceptación** (`npm run uat`) — contra el programa real, con
tiempo límite y recibos. Comprueban la capacidad completa:

| Escenario | Qué demuestra |
|---|---|
| `chain` | Un objetivo terminado da paso a otro, sin intervención. |
| `recovery` | Un fallo entre crear y confirmar se reconcilia sin duplicar. |
| `pause` | La orden de pausa detiene el trabajo en curso y la de continuar lo reanuda. |
| `budget` | Agotado el presupuesto, no se encadena otro objetivo. |

Los escenarios se ejecutan en un directorio temporal que se borra al terminar, y
dejan un recibo con el resultado de cada comprobación.

## 6. Lo que el sistema no hace

- **No se conecta a una sesión ya abierta.** El supervisor gobierna la suya
  propia. Para controlar la sesión de la interfaz gráfica haría falta un
  puente que el programa no expone.
- **No publica nada por su cuenta.** Ni `push`, ni releases, ni despliegues.
- **No inventa trabajo.** Sin evidencia en el backlog o en el repositorio, la
  misión se duerme.
- **No sortea los límites.** Si el objetivo se queda sin presupuesto o sin
  cuota, la cadena para; no crea otro objetivo para esquivarlo.
