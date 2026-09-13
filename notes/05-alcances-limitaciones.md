# Slide 5 — Cobertura del proyecto / Alcances y limitaciones

Sé honesto y directo aquí — esta slide da credibilidad porque muestra que sabes hasta dónde llega el proyecto.

**Alcances (lo que SÍ hace el sistema):**
- Multidispositivo: app móvil para escanear + módulo web para administración.
- Gestión de DataMatrix: leer con cámara y también generar/exportar el código para imprimir.
- Gestión de espacios: mapa de salas, reubicación de elementos, historial de traslados.
- Migración masiva desde los Excel actuales.

**Limitaciones (lo que NO hace, y por qué):**
- No imprime físicamente — el software genera el vector listo, pero la impresión depende del hardware del laboratorio.
- Necesita conectividad (red local o internet) para sincronizar con la BD en la nube — no funciona 100% offline.
- No automatiza compras a proveedores; solo genera alertas/reportes de reabastecimiento, la orden la hace una persona.

Frase útil si preguntan por qué no está 100% offline: la sincronización en tiempo real con la nube exige conexión; es un trade-off consciente por la trazabilidad centralizada.
