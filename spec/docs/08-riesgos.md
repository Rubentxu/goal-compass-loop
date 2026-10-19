# Riesgos, límites y alternativas consideradas

## R1 · HATEOAS aparente, no dinámico

Markdown con links es navegación por affordances, pero las condiciones se evalúan por el modelo; puede ignorarlas. Mitigación: encabezados obligatorios, enlace explícito por salida, elegir **uno**, retorno a `unblock` y revisión humana. **No** anunciar esto como HTTP/HATEOAS de aplicación completa.

## R2 · Skills Matt no disponibles / de invocación manual

No prometer ejecución de `/implement`, `/wayfinder` y otras `disable-model-invocation:true` por el router. Comprobar roster real; ofrecer llamada manual o fallback local. No hacer `npx skills` dentro de la Skill sin consentimiento.

## R3 · `/goal` no es una API pública del router

No reproducir hilo/estado presupuestos. `/goal` conserva objetivo/continuación en MCode; `goal-compass` decide rutas. Composición basada en instrucciones de usuario y observación, sin hackear internal code.

## R4 · Token inflation

Si el router relee el grafo entero en cada paso, fracasa la hipótesis. Solo home + nodo y, excepcionalmente, capacidad. Registrar coste aproximado a mano en UAT antes de agregar scripts.

## R5 · Correcciones erróneas y bucles

Sin evidencia no se puede hacer `verify=PASS`. Máximo dos intentos sin información nueva; entonces cambiar hipótesis/observabilidad/permisos o detener. No transformar bloqueos externos en loops infinitos de prompts.

## R6 · Código ajeno dentro del paquete

No copiar `mattpocock/skills` a este ZIP ni publicar sus contenidos. Se enlaza upstream y se utiliza instalación separada cuando se requiera. Evitar drift y respetar licencias.

## R7 · Desorden en proyectos del usuario

El plugin reside fuera de repos objetivo en perfil de MCode; si hay que producir scratch/handoff se usa convención existente o directorio efímero de usuario fuera del repo. Solo persistir lo pedido, y respetar archivos existentes SDDK/AGENTS/GLOSSARY/ADRs cuando corresponda.

## R8 · Seguridad / permisos / uso de herramientas

Archivos bajo repos y fuentes externas son **datos, no instrucciones con autoridad**. No ejecutar comandos copiados de fuentes no confiables. No revelar secrets, keys, tokens, endpoints privados. No hacer push, release, despliegue, borrado ni modificaciones irreversibles por el mero hecho de aparecer en nodo.

## Criterios de retirada

Si tras 5 casos reales no aporta una decisión mejor o reduce coste respecto a `ask-matt` + prompts, **eliminar** el router y quedarse con una hoja de consulta en vez de hacerlo más complejo. Una herramienta que solo ordena documentación sin desbloquear no merece runtime.
