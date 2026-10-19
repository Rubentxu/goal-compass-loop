# Propuestas de pensamiento lateral — valor frente a complejidad

Propuestas **ordenadas por valor**. Las primeras se incorporan ya al diseño; las demás son hipótesis experimentales, no requisitos para v0.1.

## Aplicar ya

1. **Grafo de preguntas, no de tareas**. Clasificar por incertidumbre y evidencia, no por etiquetas de fase. Un bug puede necesitar investigación, un plan puede necesitar un spike, una verificación puede descubrir un problema semántico. Evita transiciones lineales ficticias.
2. **La acción más informativa primero**. En vez de pedir al agente «investiga más», preguntar qué resultado invalidaría su interpretación favorita. Su experimento de máximo valor informativo suele ser un CLI corto, fuente primaria o prueba puntual.
3. **Recovery como affordance de primera clase**. Cada nodo ofrece al menos una salida lateral, además de su ruta feliz. Se comprueba tanto la idea como la capacidad de abandonarla.
4. **Stop como éxito de seguridad epistemológica**. Si no hay evidencia o permiso, stop es una salida válida, no un fallo de obediencia; separarlo de finish evita falsas certezas.
5. **Capability links lazy**. No cargar 20 skills, buscar en `/skills` solo la candidata del nodo y leer su fuente. Reduce tokens y conflictos de instrucciones.
6. **Anti-harness dirigido a decisiones**. Test de alto valor ≠ muchos tests. Una reproducción precisa puede valer más que 100 mocks. Usar `verify` para demostrar comportamiento, no «infraestructura verde».
7. **No almacenar ruta paralela al Goal**. El `/goal` nativo es autoridad del objetivo; Compass solo sabe la siguiente acción. Dos fuentes de estado tienden a divergir.

## Probar solo si aparece dolor real

8. **Fingerprints de bloqueo**. Si se observa que el modelo repite el mismo error, añadir una firma efímera `hipótesis + acción + resultado` al recibo para detectar repetición sin bases de datos.
9. **Links de capacidad deshabilitados**. Si MCode no expone una Skill, anotar «no disponible» en la respuesta y elegir fallback, nunca simular tool call.
10. **Mini-renderizador de affordances**. Únicamente si las condiciones de Markdown resultan difíciles para el agente, crear una función pura opcional `availableLinks(node, facts)`. Debe consumir la misma fuente del grafo, no un archivo de rutas duplicado. Sin servidor.
11. **Recibos reutilizables**. Un handoff pequeño —compilación de hechos y enlaces aún útiles— al pasar a otro agente, en vez de largas memorias ejecutivas. Solo cuando haya cruce real.
12. **Medición de valor de navegación**. Tras cinco UAT reales, comprobar «cambió de estrategia útil», «evidencia correcta» y «pasos evitados». Si no supera el router simple, desinstalarlo.

## Rechazadas para este alcance

Hooks `Stop` que forzan bucles; JSON/HAL/Siren obligatorio; grafo ontológico persistente; embeddings; MCP; RAG; base SQLite; orquestación multiagente; UI; estado histórico por sesión; scheduler; generador de tests E2E; port de toda la colección Matt. Cada una añade costes antes de acreditar valor.
