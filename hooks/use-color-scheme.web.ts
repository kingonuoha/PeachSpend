import { useSyncExternalStore } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

const subscribe = () => () => {};

/**
 * To support static rendering, this value needs to be re-calculated on the client side for web.
 * useSyncExternalStore reports false during server render and hydration, then true on the client.
 */
export function useColorScheme() {
  const colorScheme = useRNColorScheme();
  const hasHydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  if (hasHydrated) {
    return colorScheme;
  }

  return 'light';
}
