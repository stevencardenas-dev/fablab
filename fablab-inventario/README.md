# FabLab UFPS — App móvil

Aplicación Expo/React Native del inventario del FabLab UFPS. Lee de la base de datos MySQL a través de la API REST local.

## Desarrollo

```bash
npm install
npx expo start
```

Presiona `a` (Android), `i` (iOS) o `w` (web). En móvil real: escanear el QR con Expo Go.

## Estructura

- `src/app/` — pantallas (file-based routing de expo-router): `index.tsx` (Inicio: escanear/agregar/buscar), `explore.tsx` (Inventario por sala).
- `src/components/` — componentes UI compartidos. `_unused/` contiene sobrantes del template de Expo.
- `src/lib/inventory.ts` — lectura desde API REST (reemplaza AsyncStorage), generación de código único.
- `src/hooks/`, `src/constants/` — tema y utilidades.

## Backend

```bash
# API Server (Node.js + mysql2)
cd server && PORT=3001 node index.mjs

# MySQL (Docker)
cd .. && docker compose up -d
```

Ver `README-SERVER.md` para detalles completos.

## Base de datos

MySQL 8 con esquema normalizado: `edificios → salas → elementos` + `traslados`.
Datos: 916 elementos, 11 salas, 2 edificios (FabLab + ViveLab).

Generador SQL desde Excel: `importer/gen-normalizado.mjs "archivo.xlsx"`
