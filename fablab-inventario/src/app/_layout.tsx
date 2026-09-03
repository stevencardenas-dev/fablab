import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useState } from 'react';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import AppTabs from '@/components/app-tabs';
import { ThemeModeContext, ToggleThemeContext, type AppThemeMode } from '@/hooks/use-theme';

SplashScreen.preventAutoHideAsync();

export default function TabLayout() {
  const systemColorScheme = useColorScheme();
  const [themeMode, setThemeMode] = useState<AppThemeMode>(
    systemColorScheme === 'dark' ? 'dark' : 'light',
  );

  return (
    <ThemeModeContext.Provider value={themeMode}>
      <ToggleThemeContext.Provider value={() => setThemeMode((mode) => (mode === 'dark' ? 'light' : 'dark'))}>
        <ThemeProvider value={themeMode === 'dark' ? DarkTheme : DefaultTheme}>
          <AnimatedSplashOverlay />
          <AppTabs />
        </ThemeProvider>
      </ToggleThemeContext.Provider>
    </ThemeModeContext.Provider>
  );
}
