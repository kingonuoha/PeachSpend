import { useSegments } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isInTabsGroup, resolveBottomClearance } from './bottomClearance';

// Bottom clearance a screen must leave for the floating tab bar, resolved from
// the current host. The decision itself lives in bottomClearance.ts, which is
// pure and unit tested; this hook only feeds it the live segments and inset.
//
// `keyboardOpen` is the caller's own keyboard state, because only the chat
// screen has a keyboard and only it can know. It is not read here: mounting a
// keyboard hook in this shared hook would mount it on every tab screen, and the
// installed Reanimated hook disables Android's default window resize app-wide
// while it is mounted. The default keeps every caller without a keyboard on its
// previous value.
export function useBottomClearance(keyboardOpen = false): number {
  const segments = useSegments();
  const insets = useSafeAreaInsets();
  return resolveBottomClearance(isInTabsGroup(segments), insets.bottom, keyboardOpen);
}
