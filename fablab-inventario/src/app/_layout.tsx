import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Appearance, useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { ThemeModeContext, ToggleThemeContext, type AppThemeMode } from '@/hooks/use-theme';
import { registerServiceWorker } from '@/components/service-worker';

SplashScreen.preventAutoHideAsync();

// Registrar Service Worker para PWA (solo web)
registerServiceWorker();

export default function RootLayout() {
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
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="sala/[nombre]" />
          </Stack>
        </ThemeProvider>
      </ToggleThemeContext.Provider>
    </ThemeModeContext.Provider>
  );
}
