// Raíz HTML de la web exportada: envuelve todas las páginas. expo-router no emite
// el <link rel="manifest">, así que sin este archivo el manifest (y con él los
// íconos de PWA) nunca llega al navegador. Corre solo en Node durante el build:
// sin APIs del navegador y sin CSS global (eso va en el layout raíz).
import { ScrollViewStyleReset } from 'expo-router/html';
import { type PropsWithChildren } from 'react';

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="es">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        {/* Color de la barra del navegador en móvil (el mismo que el manifest). */}
        <meta name="theme-color" content="#C8102E" />
        <link rel="manifest" href="/manifest.json" />
        {/* iOS no usa el manifest para "Añadir a pantalla de inicio". */}
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
