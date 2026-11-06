# App (Android / iOS)

La app actual es multiplataforma (Expo/React Native), así que la misma base de
código sirve web, Android e iOS. Lo que cambia entre plataformas es **cómo se
compila y qué features quedan disponibles**.

## Defaults importantes

- **URL de la API.** En nativo no se deriva del host, así que hay que hornearla
  en el build:
  `EXPO_PUBLIC_API_URL=https://<tu-dominio-universitario>/api`.
  Tiene que apuntar **al proxy del stack Docker (el mismo dominio que la web)**,
  porque `/api` lo reenvía el nginx del stack; la API no está publicada fuera del
  contenedor.
- **Disponible solo en web:** importar inventario (selector de archivos del
  navegador). En nativo el botón no aparece; el escáner por cámara sigue
  funcionando.
- **Captchas:** la pantalla de entrada solo muestra el widget de Turnstile en web.
  En nativo el login es solo usuario y clave (igual que en el stack por defecto).
- **Fotos, etiquetas, compartir:** funcionan igual. Las etiquetas se generan
  (SVG → archivo) y se comparten por la hoja nativa (`expo-sharing`); en web
  se descargan.
- **Cámara:** la app normal usa `expo-camera` para leer Data Matrix; hay que
  declarar los permisos en `app.json` (ya lo están) y el sistema pedirá la
  autorización la primera vez.

## Compilar

Requisitos: cuenta en EAS (`eas login`), `npm install -g eas-cli`, un `Apple
Developer ID` para iOS (solo iOS).

```bash
# Android: APK instalable por archivos (sideload), sin Google Play
EXPO_PUBLIC_API_URL=https://<dominio>/api eas build --platform android --profile universidad --non-interactive

# iOS (solo si tienen cuenta Apple y quieren TestFlight / IPA):
EXPO_PUBLIC_API_URL=https://<dominio>/api eas build --platform ios --profile universidad --non-interactive
```

O edita el perfil `universidad` en `eas.json` para fijar tu URL y correr
`eas build --platform android --profile universidad` sin bandera de entorno.

El perfil `universidad` ya construye el APK en modo `apk` (no bundle para Play
Store), adequado a entornos controlados.

## Distribución

- **Android:** el `apk` se instala directamente o por MDM en los dispositivos del
  laboratorio. No hace falta Google Play.
- **iOS:** el `ipa` se instala con TestFlight (beta interna) o por sideload con
  Xcode si solo es desarrollo. Para iOS el laboratorio needing 20+ dispositivos
  acostumbra TestFlight (un developer account por año).
- Cada build queda amarrada a la URL de la API horneada; si cambia el dominio
  del stack universitario, **recompilar**.
- Versiones de la app: en `app.json` (`expo.version`) y en el perfil EAS. Subir
  el número antes de cada build que vaya a instalarse encima del anterior.
- Las actualizaciones publicadas por EAS Update (`eas update`) también sirven para
  sólo cambio de código (sin rebuild de código nativo), pero en la práctica son
  complejas en una red restringida; reconstruir el APK/iPA es el camino honesto.

## Actualizaciones sin reinstalar (EAS Update)

Una vez instalada, **no hay que reconstruir el APK** para cambios de código o
assets: el cliente consulta EAS al abrir y descarga un bundle nuevo si la
*runtime version* (actual Runtime Version) lo permite. Es el modelo "update
identifier" de Expo.

- Configurado en `app.json`: `updates.url`, policy `appVersion`, canal
  `universidad`. Usa el `projectId` de EAS existente.
- La runtime version está amarrada a la versión del **app** en `app.json`
  (`expo.version`): OTA solo reemplaza assets **dentro de la misma runtime**.
  Si añades un módulo nativo, cambias permisos, cambias icono o cambias SDK,
  hay que reconstruir porque la runtime version cambia.
- Publicar un update:
  ```
  eas update --channel universidad --message "..."
  ```
- El update requiere internet al abrir la app desde `u.expo.dev/...`. La primera
  vez necesita internet al menos una vez (si no, usa el bundle embebido).
- Un update afecta a todos los dispositivos que comparten la runtime version.
- Prudencia: el update no cambia `EXPO_PUBLIC_API_URL` (está horneada en el build
  que EAS ejecuta) — actualizar la API sigue requiriendo rebuild con la `.env`
  correcta. Elige el dominio primero.
- Tampoco arregla regresiones nativas: puede fallar si el código depende de
  un módulo que no estaba en el build reusado.

## HTTPS es obligatorio

Android en builds de producción **no** acepta HTTP sin `usesCleartextTraffic`
(en esta app no está habilitado). iOS lo bloquea siempre fuera de localhost.
El stack Docker sirve HTTP por dentro, por eso la URL que usen los builds del
teléfono **debe ir por el proxy HTTPS de la universidad**, nunca directo.

## Lo que queda fuera de este camino

- El usuario es el mismo compartido (`laboratorio`/clave del laboratorio) — no
  hay cuentas por persona ni roles, como se describe en `docs/actores.md`.
- La gestión de credenciales de firma de iOS requiere una cuenta Apple individual
  del FabLab o de un docente (ver "Traspaso").
- El deep linking `/sala/1` en nativo depende de que cada build tenga el esquema
  `fablabinventario://` registrado (ya está); funciona en builds de desarrollo Go
  pero los usuarios del tarball verán una notificación si el link se abre sin la
  app instalada.
- No hay historial de versiones de la app empaquetada; mantener versiones es
  responsabilidad del laboratorio.