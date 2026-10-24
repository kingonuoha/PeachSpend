import { TAB_BAR_HEIGHT } from './tabBarGeometry';

// The route group that owns the floating tab bar. Expo Router keeps the group in
// `useSegments()` while `usePathname()` strips it, so the segment list is the one
// reliable way to tell which host a shared screen is rendering in. That matters
// because `app/app/chat.tsx` is both the chat tab, where the bar floats over the
// content, and a stack route pushed from elsewhere, where the bar is absent.
export const TABS_GROUP_SEGMENT = '(tabs)';

// Whether the current route sits inside the tabs group and therefore under the
// floating bar.
export function isInTabsGroup(segments: readonly string[]): boolean {
  return segments.includes(TABS_GROUP_SEGMENT);
}

// Bottom clearance for a screen, resolved from its host rather than restated as a
// per-screen literal. Inside the tabs group that is the bar's full occupied
// height plus the safe area; anywhere else the bar is not mounted, so it is the
// safe area only and a pushed screen gains no dead space.
//
// `keyboardOpen` covers the one case where the bar is mounted and still not
// visible: while the keyboard is up the bar sits behind it, so reserving the
// bar's height would push a bottom docked control a bar's height above the
// keyboard and leave a band of dead space. The clearance then falls back to the
// safe area alone, which is the value a pushed screen already resolves to. The
// default keeps every caller that has no keyboard on its previous value.
export function resolveBottomClearance(
  inTabsGroup: boolean,
  safeAreaBottom: number,
  keyboardOpen = false,
): number {
  const barClearance = inTabsGroup && !keyboardOpen ? TAB_BAR_HEIGHT : 0;
  return barClearance + safeAreaBottom;
}
