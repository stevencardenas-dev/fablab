# Slide 6 — Arquitectura de software / Stack tecnológico

Nota importante para ti: el README y el código actual (fablab-inventario) usan **Expo + AsyncStorage local**, sin backend todavía. Esta slide muestra la arquitectura **objetivo/planeada**, no el estado 100% actual. Si te preguntan, aclara que hoy el prototipo corre local y el backend con Spring Boot + MySQL es la siguiente fase.

- **Frontend — React Native**: cliente multiplataforma, acceso nativo a la cámara para escanear DataMatrix de forma fluida.
- **Backend / API REST — Spring Boot**: lógica de negocio, autenticación, transacciones, y el puente para migrar los datos de Excel.
- **Base de datos — MySQL**: motor relacional en la nube, para integridad referencial (relaciones entre elementos, salas, movimientos) y persistencia centralizada.

Por qué React Native: mismo código sirve para Android/iOS, y tiene buen soporte de cámara (necesario para escanear).
Por qué relacional (MySQL) y no NoSQL: hay relaciones claras (elemento ↔ sala ↔ historial de movimientos), encajan bien en tablas con llaves foráneas.
