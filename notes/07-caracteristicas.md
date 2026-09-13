# Slide 7 — Características funcionales / Módulo móvil y web

Divide claramente los dos módulos — uno es "en campo" (para quien está físicamente en el FabLab), el otro es "de gestión" (para quien administra desde escritorio).

**Módulo móvil — operación en campo:**
- Escaneo de DataMatrix → muestra al instante ficha técnica, ubicación y estado del elemento.
- Registro e impresión → dar de alta un elemento nuevo y exportar su código para pegarlo.
- Control de stock → entradas, salidas, consumo de materiales.
- Cambios de estado/ubicación en tiempo real (operativo, mantenimiento, dañado).

**Módulo web — gestión y control:**
- Gestión de salas (alta, baja, edición de la estructura de salones/áreas).
- Migración masiva → importar los Excel existentes.
- Trazabilidad → histórico de movimientos entre salas, auditoría de cambios.

Vínculo con lo que ya existe en código: hoy el prototipo móvil ya cubre escaneo, registro y consulta por sala (ver slides 8 y 9) — el módulo web y el backend son la parte pendiente.
