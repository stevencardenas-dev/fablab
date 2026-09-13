# Slide 2 — Diagnóstico / Planteamiento del problema

El FabLab hoy administra todo (maquinaria, mobiliario, componentes electrónicos, insumos) en Excel. Eso ya no alcanza.

Puntos a explicar, uno por uno:
- **Falta de trazabilidad**: un elemento se mueve de sala y nadie actualiza el Excel a tiempo → no se sabe dónde está.
- **Proceso manual**: contar/inspeccionar a mano es lento y con errores humanos (digitación, duplicados).
- **Componentes diminutos**: un microcontrolador o una resistencia no tienen superficie para pegar una etiqueta legible — de ahí la necesidad de un código compacto (DataMatrix cabe en espacios que un QR o código de barras no).
- **Riesgo de pérdida de información**: varias copias del Excel circulando (USB, correo, computador de alguien) → versiones que se pisan entre sí, no hay una fuente única de verdad.

Frase de cierre para pasar a la siguiente slide: "por eso planteamos migrar de hojas de cálculo a una arquitectura centralizada con identificación automática."
