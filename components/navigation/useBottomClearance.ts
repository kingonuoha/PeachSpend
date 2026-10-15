import { useSegments } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isInTabsGroup, resolveBottomClearance } from './bottomClearance';

// Bottom clearance a screen must leave for the floating tab bar, resolved from
// the current host. The decision itself lives in bottomClearance.ts, which is
// pure and unit tested; this hook only feeds it the live segments and inset.
export function useBottomClearance(): number {
  const segments = useSegments();
  const insets = useSafeAreaInsets();
  return resolveBottomClearance(isInTabsGroup(segments), insets.bottom);
}
