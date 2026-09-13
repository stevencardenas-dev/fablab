# Slide 10 — Estrategia de migración / De Excel a la nube

Slide de cierre. Explica CÓMO se pasará del estado actual (Excel + prototipo local) al sistema completo, en 3 pasos:

1. **Ingesta de datos** — cargar masivamente los registros actuales de Excel hacia la base de datos relacional (primer paso técnico, sin esto no hay nada que mostrar en la app web).
2. **Migración estructurada** — transformar y validar esa información dentro de MySQL en la nube (limpieza de datos: duplicados, formatos inconsistentes del Excel original).
3. **Escalabilidad** — una vez migrado, el sistema soporta concurrencia de usuarios, persistencia real, e historial de movimientos entre salas (esto no era posible con Excel).

Cierre sugerido: "en resumen, ya tenemos el prototipo móvil funcionando localmente (slides 8-9); el siguiente hito es conectar esta migración de datos y el backend Spring Boot + MySQL para tener el sistema completo end-to-end."

Deja espacio para preguntas — los temas más probables: por qué DataMatrix y no QR (slide 4), qué pasa sin conexión (slide 5), y el estado real del backend (slide 6, aclarar que aún no existe).
