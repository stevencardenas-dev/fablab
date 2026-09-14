// Service Worker registration para PWA (solo web)
import { Platform } from 'react-native';

export function registerServiceWorker() {
  if (Platform.OS !== 'web') return;
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => console.log('[SW] Registrado:', reg.scope))
      .catch((err) => console.warn('[SW] Error:', err));
  });
}
