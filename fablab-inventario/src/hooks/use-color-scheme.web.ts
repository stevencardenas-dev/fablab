import { useSyncExternalStore } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

// To support static rendering, this value needs to be re-calculated on the client side for web
//
// useSyncExternalStore en vez de useEffect+setState (react-hooks/set-state-in-effect):
// durante el prerender/hidratación getServerSnapshot devuelve false → 'light' (igual que
// el HTML prerenderizado), y en el cliente pasa a true → esquema real, sin mismatch.
const emptySubscribe = () => () => {};
const siempre = () => true;
const nunca = () => false;

export function useColorScheme() {
  const hasHydrated = useSyncExternalStore(emptySubscribe, siempre, nunca);
  const colorScheme = useRNColorScheme();

  if (hasHydrated) {
    return colorScheme;
  }

  return 'light';
}
