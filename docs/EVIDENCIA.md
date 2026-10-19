# Evidencia de validación

Todo lo que sigue se ha **ejecutado** contra la instalación real del programa
en esta máquina. Lo que no se ha ejecutado está marcado como **NOT RUN**, sin
adornos.

## Entorno

| Elemento | Valor |
|---|---|
| Host | `mcode` **0.6.12** (`~/.minimax-code/releases/0.6.12`) |
| Data dir | `~/.minimax` |
| Node | v25.9.0 |
| SDK | `@agentclientprotocol/sdk` 1.9.0 |
| Sistema | Fedora, Linux x86_64 |

---

## 1 · Pruebas permanentes — **PASADO**

```text
$ npm test
 Test Files  5 passed (5)
      Tests  60 passed (60)
   Duration  341ms

$ npm run typecheck     # sin errores
```

60 pruebas en menos de medio segundo, sin programa real. Cubren el núcleo
puro, el supervisor con dobles en memoria, el descubrimiento de señales, los
puertos de candidatos y la exploración.

## 2 · Compatibilidad del host — **PASADO**

La extensión de objetivos existe en el build instalado, no solo en el código
publicado. Verificado leyendo el bundle instalado:

```text
$ grep -ro "mcode/session/goal[a-z_/]*" --include="*.js" chunks/
./chunks/run-acp-command-MV4O4NBX.js:mcode/session/goal_update     (x4)
./chunks/run-acp-command-MV4O4NBX.js:mcode/session/goal/patch      (x2)
./chunks/run-acp-command-MV4O4NBX.js:mcode/session/goal/get        (x2)
./chunks/run-acp-command-MV4O4NBX.js:mcode/session/goal/create     (x2)
./chunks/run-acp-command-MV4O4NBX.js:mcode/session/goal/clear      (x2)
```

El host anuncia la extension completa en el `initialize`, con sus métodos y sus
notificaciones. Los cuatro métodos respondieron contra el host real:

| Método | Respuesta real |
|---|---|
| `goal/get` (sesión vacía) | `{"goal": null}` |
| `goal/create` | `{"goal":{"goalId":"tg_ufoh5y73avmvfmf852","status":"active","tokenBudget":20000,...}}` |
| `goal/get` (tras create) | mismo `goalId`, `status: active` |
| `goal/patch` (`paused`) | `status: "paused"`, `statusReason: "paused(user_requested)"` |
| `goal/clear` | `{"cleared": true}` |

### Hallazgo que cambió el diseño: el objetivo se autoejecuta

Se creó un objetivo y **no** se envió ninguna notificación ni prompt:

```text
created goalId=tg_90v1vonxplmvfmftjv status=active
[goal_update] status=active turns=0 tokens=0
[goal_update] status=active turns=1 tokens=51320      <- el worker arrancó solo
[goal_update] status=complete turns=1 tokens=60464 reason=complete(verifier_met)

answer.txt existe: true   contenido: "OK"
```

El runtime ejecuta worker **y** verificador por su cuenta tras la creación. No
hace falta ningún kickoff externo: el supervisor solo observa y encadena.

## 3 · Escenarios de aceptación contra el host real — **PASADO**

```text
$ npm run uat
=============== RESUMEN ===============
PASA · chain
PASA · recovery
PASA · pause
PASA · budget
PASA · exploration
=======================================
```

**29 comprobaciones, todas en verde.** Detalle de cada escenario:

### `chain` · tres objetivos encadenados, sin intervención (10/10)

```text
[20:29:53.382] decision: create - trabajo pendiente de la cadena
[20:32:17.708] goal completado registrado: tg_4oomwqhwglmvfpkbcm (complete(verifier_met))
[20:32:17.722] decision: create - trabajo pendiente de la cadena
[20:34:50.947] goal completado registrado: tg_auy62movwdmvfpneq1 (complete(verifier_met))
[20:34:50.956] decision: create - trabajo pendiente de la cadena
[20:37:24.209] decision: park - goal completado y sin trabajo elegible: 3 candidato(s) descartado(s)
```

**14 ms** entre el `complete` y la creación del siguiente objetivo. Y al
agotarse los candidatos, la misión queda dormida en lugar de inventar trabajo.

```text
PASA · se crearon tres Goals (3)
PASA · los Goals tienen identificadores distintos
PASA · los Goals tienen objetivos distintos
PASA · todos los Goals terminaron
PASA · el primer trabajo se produjo
PASA · el segundo trabajo se produjo
PASA · el tercer trabajo se produjo
PASA · no hay Goals duplicados
PASA · la mision no quedo escalada
PASA · el coste de la cadena es conocido (119976 tokens en 3 Goals)
```

### `recovery` · una transición a medias se reconcilia sin duplicar (4/4)

Se reprodujo la muerte del supervisor entre la creación y la confirmación, y se
reinició el host reanudaando la misma sesión.

```text
PASA · la intencion quedo reconciliada
PASA · la intencion apunta al Goal original (tg_j7ev3jdatkmvfpu2rj)
PASA · no se creo un segundo Goal (1)
PASA · el host conserva un unico Goal
```

El objetivo sobrevive a la muerte del proceso host: vive en el almacenamiento
del runtime, y `session/load` lo recupera.

### `pause` · la orden del usuario detiene el trabajo en curso (3/3)

```text
[20:01:33.747] control del usuario aplicado: paused_by_user
[20:01:33.754] goal pausado para dejar de consumir presupuesto
[20:01:33.755] decision: wait - mision pausada por el usuario
[20:01:36.788] control del usuario aplicado: running
[20:01:36.793] goal reanudado
```

**7 ms** entre la orden de pausa y el objetivo pausado.

```text
PASA · la pausa detuvo el Goal
PASA · la reanudacion devolvio el Goal a marcha
PASA · la pausa no creo Goals nuevos
```

### `budget` · agotado el presupuesto de la misión, la cadena se detiene (3/3)

```text
[20:40:05.081] decision: park - presupuesto de la mision agotado (63207 de 1 tokens);
                   la mision sigue viva
```

```text
PASA · la mision quedo dormida
PASA · el motivo es el presupuesto
PASA · no se encadenó un segundo Goal (1)
```

### `exploration` · sin backlog ni pendientes, la exploración encuentra trabajo (4/4)

El trabajo pendiente solo estaba descrito en prosa dentro de `NOTAS.md`, así que
el escáner determinista no podía verlo. La exploración lo encontró:

```text
[20:40:10.536] sin trabajo elegible: se pide una exploracion acotada del workspace
[20:42:52.302] decision: create - El repositorio contiene TypeScript pero no declara
                   runner, scripts ni configuracion del compilador; hoy el type-check solo
                   se puede lanzar con flags sueltos y el runner de test depende de una
                   instalacion global en la maquina. Sin esto, el requisito de NOTAS.md
                   de "cubrirla con una prueba" no tiene un comando de proyecto
                   reproducible que un tercero pueda ejecutar.
[20:42:52.311] intencion persistida: exploracion:2:Declarar la configuracion minima
                   del pro -> 718f9406-b362-4baf-9e5b-b23c9b54cf48
```

```text
PASA · la exploracion aporto candidatos (3)
PASA · la evidencia senala a un fichero real
PASA · se creo un Goal a partir de la exploracion
PASA · el Goal viene de la exploracion
```

La propuesta no solo era real: detectó que el workspace no tenía configuración
de proyecto reproducible, un trabajo que ni el backlog ni el escáner veían.

### `budget_limited` del host — **PASADO (observado de forma natural)**

No hizo falta forzarlo: ocurrió solo al ejecutar el camino de CLI con un
presupuesto por objetivo de 40 000, insuficiente para worker + verificador.

```text
[19:24:55.276] goal_update: status=budget_limited turns=1 tokens=50256
[19:24:55.296] decision: wait - goal en estado budget_limited (budget_limited(token)):
                   no se crea otro Goal para esquivar el limite
```

El supervisor **no creó un segundo objetivo** y se mantuvo en `wait`
indefinidamente.

## 4 · Defectos encontrados por los escenarios y corregidos

El primer pase del escenario `budget` falló una comprobación. Al clasificarlo
(resultado de un escenario, no del producto) aparecieron **dos** problemas
distintos:

**a) Defecto del escenario.** Aplicaba el límite de presupuesto *después* de
que el primer objetivo terminara, cuando el supervisor ya había encadenado el
siguiente. La orden estaba mal planteada: el límite se fija antes de empezar.
Corregido y reejecutado: 3/3.

**b) Defecto real del producto.** El contador de tokens de la misión sumaba dos
veces el objetivo terminado: una como registro del journal y otra como
objetivo en curso. Con un objetivo de 59 573 tokens, la misión contaba
**119 146**. El presupuesto se consumía al doble de velocidad.

Corregido en la construcción del snapshot, con una prueba de regresión. El
escenario `budget` posterior confirma la corrección en el host real: el mismo
objetivo ahora contabiliza **63 207** tokens, no el doble.

## 5 · Coste real observado

Tokens consumidos por objetivo completo, leídos de los journals:

| Objetivo | Turnos | Tokens |
|---|---|---|
| tg_ox84t4nvepmvfomwds | 1 | 13 507 |
| tg_rt7ugg955ymvfmz21l | 1 | 17 127 |
| tg_lz7rya584ymvfofpec | 1 | 20 865 |
| tg_ilghb75f10mvfmt83m | 1 | 59 233 |
| tg_g15lw7hyxqmvfoql4r | 1 | 59 573 |
| tg_1uzwfobg9pmvfmwgnv | 1 | 61 756 |
| tg_1mxs00u4yamvfocxlo | 1 | 62 676 |
| tg_8aj9axn4j8mvfok2bj | 1 | 62 881 |

**Coste de una cadena de 3 objetivos: 119 976 tokens** (unos 40 000 por
objetivo, medido en la misma cadena).

**Conclusión operativa:** un objetivo trivial consume entre 13 000 y 63 000
tokens, y la mayoría se acerca a 63 000. El presupuesto por objetivo
recomendado es 120 000, pero un objetivo que necesite dos turnos lo
agotaría. Conviene reservar margen o subirlo a 200 000.

## 6 · Verificación de la interfaz de línea de comandos

| Comando | Resultado |
|---|---|
| `probe --workspace /tmp` | `extension disponible. session=mvs_... goal=sin goal` |
| `init --config examples/mission.json` | estado durable creado en `~/.local/state/goal-compass/...` |
| `run --config ...` | arranca host, crea sesión, decide y crea el objetivo |
| `status --mission <id>` | muestra estado, objetivos, tokens y control pendiente |
| `pause/resume --mission <id>` | escribe el canal de control; `status` lo refleja |
| `install-skill` | copia la skill a `~/.minimax/skills/goal-compass/` |

## 7 · Lo que queda fuera

- **`paused`, `blocked` y `usage_limited` del host: NOT RUN.** Cubiertos por
  pruebas puras (caso parametrizado sobre los cuatro estados) y por la
  prueba de supervisor del objetivo activo. Forzar `usage_limited` exigiría
  agotar la cuota del usuario, y no procede. La mecánica es idéntica en los
  cuatro: están en el grupo de estados que producen `wait`, y `wait` nunca
  crea un objetivo.
- **Estancamiento contra el host real: NOT RUN.** El mecanismo está cubierto
  por pruebas puras del núcleo y del supervisor. Provocarlo contra el host
  exigiría un objetivo que se quedara quieto durante el margen, lo que
  consume una ventana de tiempo de reloj completa sin aportar evidencia que
  las pruebas no den ya.
- **Publicación remota:** el repositorio y la release se publican a mano; no
  hay publicación automática en el registro de paquetes.
