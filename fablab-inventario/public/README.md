# public/

Archivos que se copian tal cual al sitio web exportado (`dist/`).

| Archivo | Para qué |
|---|---|
| `sw.js` | Service worker de la PWA: guarda la app para abrirla sin red. **Subir `CACHE_NAME` en cada despliegue con bundle nuevo**, o los navegadores siguen con la versión vieja |
| `manifest.json` | Nombre, íconos y colores para instalar la app en la pantalla de inicio |
| `_redirects` | Regla de rutas para hosts que la soportan (Render no la aplica; nginx en Docker resuelve los deep links) |
