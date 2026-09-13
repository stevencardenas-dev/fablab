# Slide 9 — Avance del desarrollo / Consulta del inventario

Segunda parte de la demo: **consultar** lo que ya está registrado. Corresponde a `src/app/(tabs)/explore.tsx` y `src/app/sala/[nombre].tsx`.

Flujo a narrar:
1. **Búsqueda** — buscar un elemento por nombre/código.
2. **Inventario por sala** — vista de todos los elementos agrupados por sala/salón (organización espacial del FabLab).
3. **Detalle de sala** — al entrar a una sala específica, ver qué hay dentro.
4. **Ficha del elemento** — detalle individual, con foto del elemento (usa `expo-image-picker`/`expo-image`).

Punto fuerte a resaltar: todo esto ya funciona hoy en el prototipo, corriendo localmente (AsyncStorage) — es la base sobre la que se conectará el backend en la siguiente etapa.
