# src/

La app (Expo / React Native), que corre como app móvil y como web instalable (PWA).
Descripción de pantallas y flujos: [`../docs/app.md`](../docs/app.md).

| Carpeta | Contenido |
|---|---|
| `app/` | Pantallas, con rutas por archivo (expo-router): `(tabs)/index.tsx` Inicio, `(tabs)/explore.tsx` Inventario, `sala/[nombre].tsx` una sala, `_layout.tsx` raíz |
| `lib/` | Lógica sin interfaz y con pruebas: cliente de la API y caché (`inventory.ts`), fotos (`foto.ts`, `foto-optimizar.ts`), Data Matrix en SVG (`data-matrix-svg.ts`), hoja de etiquetas (`hoja-imprimible.ts`). Los `*.test.ts` corren con `npm test` |
| `components/` | Piezas de interfaz: Data Matrix (`data-matrix.tsx`), lector con la cámara (`scanner.tsx`), barra de pestañas, registro del service worker. `_unused/` guarda restos de la plantilla, fuera de las pruebas |
| `hooks/` | Esquema de color claro/oscuro (nativo y web) |
| `constants/` | Colores, espaciados y anchos del tema |

Archivos con sufijo `.web.tsx` / `.web.ts` reemplazan a su par en el navegador.
La dirección de la API sale de `EXPO_PUBLIC_API_URL` al compilar
(ver [`../docs/operacion.md`](../docs/operacion.md)).
