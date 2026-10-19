# Prompts socráticos y muestras de trayectorias

## Prompt de uso genérico

`/goal-compass <objetivo>. Antes de seguir, identifica la evidencia que falta. Navega una opción cada vez y reevalúa tras cada resultado. Minimiza tests y complejidad; no declares terminado sin prueba.`

## Casos útiles de investigación y desbloqueo

### Caso A: Terraform indexador con cero relaciones

**Entrada:** `Tenemos 258 símbolos, 0 relaciones y 139 archivos omitidos: ¿qué ruta seguir sin inventar un diagrama?`

**Ruta esperada:** `hub → investigate`: confirmar tipos de archivos realmente indexados, semántica de relaciones y cobertura; `probe`: un fixture real mínimo `.tf`/`.tfvars` con relación esperada; `unblock/stop` si no hay un seam o falta soporte. **Nunca:** inventar relaciones C4 ni tratar `atlas CURRENT` como arquitectura probada.

### Caso B: test harness frenando entrega

**Entrada:** `Los tests de integración explotan cada cambio y hay más harness que código de producto.`

**Ruta esperada:** `hub → investigate`: medir por categoría e identificar protección real; `plan` acotar poda; `implement` sustituir por 1 test al seam; `verify` comprueba conducta esencial, no número bruto de tests. Evitar reinstalar harness.

### Caso C: falta endpoint del proveedor

**Entrada:** `El plugin necesita soportar una API de MiniMax cuya forma no conozco.`

**Ruta esperada:** `investigate`: leer fuente primaria; `probe`: llamada no destructiva con autorización; `unblock`: distinguir límites de red, credenciales, API no implementada. Si faltan permisos, detener con una petición concreta al usuario.

### Caso D: reparo de pocas líneas

**Entrada:** `Corrige este fallo de null en parser Kotlin, un test relevante y commit.`

**Ruta esperada:** `diagnose → implement → verify → deliver`; sin fase pesada de diseño ni suite completa hasta gate acordado. No hacer push remoto si el usuario no lo autorizó.

### Caso E: esfuerzo muy grande

**Entrada:** `Migrar cientos de jobs Jenkins a PipelineK sin ruta clara.`

**Ruta esperada:** `plan` determina incertidumbres decisivas, sugiere `/wayfinder` (solo usuario), 1 pregunta de alto valor, o descompone 1 rebanada segura. No fabricar roadmap de 50 hitos por defecto.

## Formato de respuesta simulado (no pretende salida de MCode)

```text
Objetivo: aislar ausencia de relaciones de Terraform.
Nodo: investigate · cobertura real de relaciones desconocida.
Evidencia: 0 relaciones observadas; no demuestra que no existan dependencias.
Acción mínima: ejecutar una consulta sobre un .tf con una referencia inequívoca.
Salida: pendiente.
Siguiente: probe si podemos contrastar fixture; unblock si el parser no lo soporta.
```

Se elige **un** enlace tras observar el resultado; la respuesta no debe aparentar que recorrió ambos.
