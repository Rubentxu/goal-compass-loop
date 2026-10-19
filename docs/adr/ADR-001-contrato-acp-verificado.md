# ADR-001 · Contrato ACP de Goal verificado contra MCode 0.6.12

**Estado:** aceptado · **Fecha:** 2026-10-19 · **Sustituye a:** suposiciones del kit v0.2

## Contexto

El kit de especificaciones (Goal Compass Loop v0.2) asumía el contrato de la
extensión ACP de Goal a partir del código de `main` de GitHub. Antes de
implementar el adaptador había que **verificarlo contra la instalación real**,
porque el roadmap exigía «no fabricar integración ni afirmar éxito» (M0).

## Decision

Se implementa contra el host real `mcode acp` (MCode **0.6.12**, instalado en
`~/.minimax-code/releases/0.6.12`) y se documenta el contrato observado.

## Contrato verificado

### Negociacion

El cliente debe declarar la extension en `initialize`:

```json
{ "clientCapabilities": { "_meta": { "minimax-code/extensions": { "version": 1, "notifications": true } } } }
```

El host responde con `_meta["minimax-code/extensions"]` conteniendo `version`,
`methods` y `notifications`. Si el host **no anuncia** los metodos de Goal, el
supervisor **falla cerrado** (`IncompatibleHostError`). No se intenta un
fallback.

El anuncio esta condicionado por `runtime.isGoalEnabled()`. Si la funcion de
Goal esta deshabilitada, los metodos de Goal no aparecen en `methods` y la
notificacion `mcode/session/goal_update` no aparece en `notifications`.

### Metodos

| Metodo | Params | Respuesta |
|---|---|---|
| `mcode/session/goal/get` | `{ sessionId }` | `{ goal: GoalState \| null }` |
| `mcode/session/goal/create` | `{ sessionId, objective, tokenBudget? }` | `{ goal: GoalState }` |
| `mcode/session/goal/patch` | `{ sessionId, status?, objective?, tokenBudget? }` | `{ goal: GoalState }` |
| `mcode/session/goal/clear` | `{ sessionId }` | `{ cleared: boolean }` |

`goal/patch` acepta como `status`: `active`, `paused`, `blocked`, `complete`,
`budget_limited`. `goal/create` exige `objective` no vacio.

### Notificacion

`mcode/session/goal_update` con `{ sessionId, goal }`, o
`{ sessionId, goal: null, goalId }` cuando el Goal se limpia.

### `GoalState` real

```ts
{
  goalId: string;            // "tg_..."
  sessionId: string;         // "mvs_..."
  objective: string;
  status: 'active'|'paused'|'blocked'|'complete'|'budget_limited'|'usage_limited';
  createdAt: number;         // epoch ms
  updatedAt: number;
  tokensUsed: number;
  turnsUsed: number;
  timeUsedSeconds: number;
  tokenBudget?: number;
  statusReason: string | null;   // p.ej. "complete(verifier_met)"
  executionWait: unknown;
  hasKickoffAttachments: boolean;
  lastVerification?: {           // presente cuando el runtime ejecuto el verificador
    backend: string; verdict: string; reason: string;
    missing: string[]; notMetStreak: number; at: number;
  } | null;
}
```

## Hallazgos que cambian el diseno

1. **El Goal se autoejecuta.** Tras `goal/create`, el Runtime arranca la
   continuacion por si mismo: **no** hace falta `session/prompt` ni ningun
   kickoff externo. Verificado: create -> `turns=1` -> `complete(verifier_met)`
   sin ninguna llamada del supervisor.
2. **Hay fase de verificador.** El Goal recorre un *worker* y luego un
   *verificador* (subagente). `statusReason` distingue `complete(worker_proposal)`,
   `complete(verifier_met)` y `complete(user_requested)`.
   `complete(user_requested)` es el valor **por defecto** cuando no hay motivo
   explicito, asi que **no** es una senal fiable de intervencion del usuario:
   encadenar se decide por `status === 'complete'`, no por el motivo.
3. **`create` sobre un Goal `complete` es el camino soportado.** No hace falta
   `clear` previo; el runtime reemplaza el Goal completo (es lo que hace `/goal
   <objective>` en la TUI).
4. **La TUI abierta no es controlable.** `mcode acp` es un host independiente
   con su propio cliente ACP. El supervisor gobierna **su** sesion.
5. **`ClientSideConnection` no expone `close()`** en el SDK 1.9.0. Como el
   supervisor es dueno del proceso host, el cierre real es terminar el proceso.

## Consecuencias

- El supervisor puede esperar sin gastar tokens: la senal de avance es una
  notificacion, y el sondeo por `get` es la red de seguridad.
- La idempotencia se apoya en el **estado** (`get`), no en el evento: una
  notificacion repetida no cambia nada porque la autoridad es el Goal vivo.
- El limite `budget_limited` / `usage_limited` se respeta sin excepcion: crear
  otro Goal para esquivarlo seria el equivalente a saltarse un quota.

## Alternativas descartadas

- **Escribir en la base SQLite interna de MCode:** prohibido; superficie no
  soportada y romperia el formato.
- **Usar hooks `Stop` para rearmar el bucle:** no tienen autoridad de creacion
  y su semantica es de observabilidad.
- **Conectar a la TUI ya abierta:** no hay soporte documentado; se crearia una
  segunda autoridad sobre la misma sesion.
