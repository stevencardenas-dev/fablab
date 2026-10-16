// Layout raíz de la app (expo-router): tema claro/oscuro, splash animado,
// registro del service worker de la PWA y la barra de pestañas.
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Appearance, useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { ThemeModeContext, ToggleThemeContext, type AppThemeMode } from '@/hooks/use-theme';
import { registerServiceWorker } from '@/components/service-worker';
import { prewarmCache } from '@/lib/inventory';
import { cargarSesion } from '@/lib/sesion';
import { PantallaEntrada } from '@/components/pantalla-entrada';
import { useSesion } from '@/hooks/use-sesion';

SplashScreen.preventAutoHideAsync();

// Registrar Service Worker para PWA (solo web)
registerServiceWorker();

export default function RootLayout() {
  // Calienta la cache del inventario apenas abre la app: cuando el usuario
  // entra a Inventario los datos ya están (carga instantánea).
  const { cargada, usuario } = useSesion();
  useEffect(() => {
    cargarSesion(); // sesión guardada del laboratorio, si no venció
  }, []);
  // La caché se calienta solo con sesión: sin ella el server rechaza las lecturas.
  useEffect(() => {
    if (usuario) prewarmCache();
  }, [usuario]);

  const systemColorScheme = useColorScheme();
  const [themeMode, setThemeMode] = useState<AppThemeMode>(
    systemColorScheme === 'dark' ? 'dark' : 'light',
  );

  return (
    <ThemeModeContext.Provider value={themeMode}>
      <ToggleThemeContext.Provider
        value={() => {
          setThemeMode((mode) => {
            const next = mode === 'dark' ? 'light' : 'dark';
            // Aplica el esquema a nivel nativo (root view, barras del sistema):
            // solo cambiar el estado dejaba el chrome nativo en oscuro en Expo Go.
            // En web Appearance.setColorScheme no existe (react-native-web) → no-op seguro.
            if (Appearance.setColorScheme) {
              try { Appearance.setColorScheme(next); } catch { /* no-op en web */ }
            }
            return next;
          });
        }}>
        <ThemeProvider value={themeMode === 'dark' ? DarkTheme : DefaultTheme}>
          <AnimatedSplashOverlay />
          {/* Iconos de la barra de estado legibles en ambos temas */}
          <StatusBar style={themeMode === 'dark' ? 'light' : 'dark'} />
          {/* Sin sesión no se muestra nada de la app: solo la pantalla de entrada.
              Mientras se lee la sesión guardada no se pinta nada (evita un parpadeo). */}
          {!cargada ? null : usuario ? (
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="sala/[nombre]" />
            </Stack>
          ) : (
            <PantallaEntrada />
          )}
        </ThemeProvider>
      </ToggleThemeContext.Provider>
    </ThemeModeContext.Provider>
  );
}
