// Service Worker registration para PWA (solo web)
import { Platform } from 'react-native';

export function registerServiceWorker() {
  if (Platform.OS !== 'web') return;
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;

  // Si el bundle evalúa después del evento load (pasa en primera visita según
  // la red), un listener de 'load' nunca dispara y el SW queda sin registrar.
  const registrar = () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => console.log('[SW] Registrado:', reg.scope))
      .catch((err) => console.warn('[SW] Error:', err));
  };
  if (document.readyState === 'complete') registrar();
  else window.addEventListener('load', registrar, { once: true });
}
