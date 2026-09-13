# Slide 8 — Avance del desarrollo / Registro de elementos

Esta es una demo en vivo o screenshots del flujo de **alta de un elemento**. Corresponde al código real en `fablab-inventario/src/app/(tabs)/index.tsx` y `src/components/data-matrix.tsx`.

Flujo a narrar mientras muestras las capturas (o haces la demo en vivo con `npx expo start`):
1. **Inicio** — pantalla principal con opciones de escanear/agregar/buscar.
2. **Agregar elemento** — formulario para dar de alta un nuevo ítem del inventario.
3. **DataMatrix generado** — el sistema genera automáticamente un código único para ese elemento (ver `src/lib/inventory.ts`, función de generación de código).
4. **Escaneo por cámara** — usando `expo-camera` + `datamatrix-decode`, se puede volver a leer ese código para identificar el elemento después.

Si vas a hacer demo en vivo: ten `npx expo start` corriendo antes de la presentación, prueba el escaneo con buena luz (la cámara del teléfono necesita foco claro sobre el código).
