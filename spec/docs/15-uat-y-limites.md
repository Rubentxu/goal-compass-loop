# Validación mínima: Goal → nuevo Goal

## Gates por orden

1. **G0 · Compatibilidad real (bloqueante):** `mcode --version`, `mcode acp`, handshake, sesión, método ACP de Goal anunciado, `get` y `create` válidos. Probar en Session desechable, aislada de la TUI; verificar notificación exacta. Si falla, no se declara v1 autónoma.
2. **G1 · Núcleo puro:** `python3 reference/check_chain_core.py`, seis ejemplos deterministas, sin red ni dependencias.
3. **G2 · UAT 1 (efímero):** dos Goals con aceptación inequívoca. Primer Goal completa, segundo se crea una sola vez y comienza; confirmación por `get` de id nuevo.
4. **G3 · UAT 2 (efímero):** matar/reiniciar supervisor tras `create` pero antes de confirmar; no duplicar ni ejecutar tarea 1 dos veces.
5. **G4 · UAT 3 (efímero):** sin backlog: descubrimiento acotado; si no encuentra candidato, `parked` y espera cambio (sin ciclos de tokens).
6. **G5 · UAT 4 (efímero):** `paused`, `blocked`, `budget_limited`, `usage_limited` no disparan nuevo Goal saltándose la restricción; pausa inmediata del usuario.

Pruebas de integración de ACP: 1 por frontera/capacidad, no una matriz exhaustiva. Las UAT se ejecutan fuera del repositorio y se retiran tras el gate. Guardar solo identificadores, resumen de evidencia y defectos reales. No montar harness grande.

## Resultados actuales (en este kit)

- G1: verificar con `python3 reference/check_chain_core.py`.
- G0/G2–G5: NO ejecutados contra instalación real del usuario.
- No afirmar que el ZIP arranque un daemon o cree Goals reales hasta implementar ACP + negociar permisos.

## Riesgo prioritario

Un cliente ACP propio **inicia** `mcode acp`; no se conecta automáticamente a la TUI existente, y la TUI admite su propio cliente. Evitar lanzar múltiples hosts con la misma base SQLite y proyecto sin confirmar aislamiento/compatibilidad. Si el requisito es «operar desde la TUI abierta», investigar extensión oficial de host o puente soportado; no escribir SQLite ni hacer inyección de comandos de terminal.
