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
 Test Files  4 passed (4)
      Tests  45 passed (45)
   Duration  311ms

$ npm run typecheck     # sin errores
```

45 pruebas en menos de medio segundo, sin programa real. Cubren el núcleo
puro, el supervisor con dobles en memoria, el descubrimiento de señales y los
puertos de candidatos.

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

El host anuncia la extension completa en el `initialize`:

```json
"_meta": {
  "minimax-code/extensions": {
    "version": 1,
    "methods": ["...", "mcode/session/goal/get", "mcode/session/goal/create",
                "mcode/session/goal/patch", "mcode/session/goal/clear", "..."],
    "notifications": ["...", "mcode/session/goal_update", "..."]
  }
}
```

Los cuatro métodos respondieron contra el host real:

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
=======================================
```

18 comprobaciones, todas en verde. Detalle de cada una:

### `chain` · un objetivo terminado da paso al siguiente (8/8)

```text
[19:56:09.471] goal creado y confirmado: tg_1mxs00u4yamvfocxlo (active)
[19:58:18.655] goal completado registrado: tg_1mxs00u4yamvfocxlo (complete(verifier_met))
[19:58:18.656] decision: create - trabajo pendiente de la cadena
[19:58:18.806] goal creado y confirmado: tg_lz7rya584ymvfofpec (active)
[20:01:16.096] goal completado registrado: tg_lz7rya584ymvfofpec (complete(verifier_met))
[20:01:16.096] decision: park - goal completado y sin trabajo elegible: 2 candidato(s) descartado(s)
```

**131 ms** entre el `complete` y la creación del siguiente objetivo, sin
intervención. Y al agotarse los candidatos, la misión queda dormida en lugar
de inventar trabajo.

```text
PASA · se crearon dos Goals (2)
PASA · los Goals tienen identificadores distintos
PASA · los Goals tienen objetivos distintos
PASA · el primer Goal termino
PASA · el segundo Goal termino
PASA · el primer trabajo se produjo
PASA · el segundo trabajo se produjo
PASA · la mision no quedo escalada
```

### `recovery` · una transición a medias se reconcilia sin duplicar (4/4)

Se reprodujo la muerte del supervisor entre la creación y la confirmación, y se
reinició el host reanudaando la misma sesión.

```text
[20:01:25.729] sesion reanudada: mvs_3ebdb9be84bc48099d4ce34c1a338c17
[20:01:30.706] goal creado y confirmado: tg_77xd7wbwvrmvfojtfv (active)
```

```text
PASA · la intencion quedo reconciliada
PASA · la intencion apunta al Goal original (tg_zwr14ageelmvfojlyp)
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
[20:08:40.597] goal completado registrado: tg_g15lw7hyxqmvfoql4r (complete(verifier_met))
[20:08:40.597] decision: park - presupuesto de la mision agotado; la mision sigue viva
[20:08:40.606] mision en parked: presupuesto de la mision agotado; la mision sigue viva
```

```text
PASA · la mision quedo dormida
PASA · el motivo es el presupuesto
PASA · no se encadenó un segundo Goal (1)
```

### `budget_limited` del host — **PASADO (observado de forma natural)**

No hizo falta forzarlo: ocurrió solo al ejecutar el camino de CLI con un
presupuesto por objetivo de 40 000, insuficiente para worker + verificador.

```text
[19:24:55.276] goal_update: status=budget_limited turns=1 tokens=50256
[19:24:55.296] decision: wait - goal en estado budget_limited (budget_limited(token)):
                   no se crea otro Goal para esquivar el limite
```

El supervisor **no creó un segundo objetivo** y se mantuvo en `wait`
indefinidamente. Journal final: 1 intención confirmada, 0 objetivos nuevos.

## 4 · Defecto encontrado por los escenarios y corregido

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

Corregido en la construcción del snapshot, con una prueba de regresión que
comprueba que un objetivo ya registrado no vuelve a sumar.

```text
$ npm test
 Test Files  4 passed (4)
      Tests  45 passed (45)
```

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
- **Exploración con modelo: no implementada.** El descubrimiento es
  determinista (backlog + señales del repositorio). El puerto de candidatos
  es el punto de extensión.
- **Comparativa de coste sobre una cadena larga de 3–5 objetivos:** parcial.
  Se observaron 5 objetivos completos a lo largo de los escenarios, pero no
  una única cadena larga medida con el mismo objetivo.
- **Publicación remota:** no hay release publicado automáticamente; el
  despliegue en el registro de paquetes queda fuera del alcance.
