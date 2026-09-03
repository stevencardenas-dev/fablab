/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { createContext, useContext } from 'react';

export type AppThemeMode = 'light' | 'dark';

export const ThemeModeContext = createContext<AppThemeMode | undefined>(undefined);
export const ToggleThemeContext = createContext<() => void>(() => undefined);

export function useThemeMode(): AppThemeMode {
  const contextMode = useContext(ThemeModeContext);
  const systemScheme = useColorScheme();

  return contextMode ?? (systemScheme === 'dark' ? 'dark' : 'light');
}

export function useToggleTheme() {
  return useContext(ToggleThemeContext);
}

export function useTheme() {
  return Colors[useThemeMode()];
}
