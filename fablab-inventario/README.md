# FabLab UFPS — App móvil

Aplicación Expo/React Native del inventario. Ver el README del repo para el contexto general del proyecto.

## Desarrollo

```bash
npm install
npx expo start
```

Presiona `a` (Android), `i` (iOS) o `w` (web) en la terminal de Expo, o escanea el QR con la app Expo Go.

## Estructura

- `src/app/` — pantallas (file-based routing de expo-router): `index.tsx` (Inicio: escanear/agregar/buscar), `explore.tsx` (Inventario por sala).
- `src/components/` — componentes UI compartidos. `_unused/` contiene sobrantes del template de Expo, sin usar.
- `src/lib/inventory.ts` — persistencia local (AsyncStorage) y generación de código único.
- `src/hooks/`, `src/constants/` — tema y utilidades.

## Datos

Todo se guarda localmente en el dispositivo (AsyncStorage) — no hay backend todavía.
