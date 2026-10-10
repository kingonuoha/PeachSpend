// The tab routes for the `(tabs)` group, shared by the tab bar layout and its
// test. Expo Router may report `usePathname()` stripped of the route group
// (`/profile`) or, on some versions and deep links, with the group still present
// (`/(tabs)/profile`). The active tab is therefore resolved by normalizing both
// the incoming pathname and the stored path and href, never by a single exact
// string compare a group prefix can defeat.
export interface TabRoute {
  // Navigation href, including the group, for router.push.
  href: string;
  // The pathname usePathname() reports for this tab. Home is '/' because its
  // file is index.tsx inside the group; the group segment is not in the URL.
  path: string;
  label: string;
}

export const TAB_ROUTES: readonly TabRoute[] = [
  { href: '/(tabs)', path: '/', label: 'Home' },
  { href: '/(tabs)/analytics', path: '/analytics', label: 'Insights' },
  { href: '/(tabs)/chat', path: '/chat', label: 'AI Chat' },
  { href: '/(tabs)/profile', path: '/profile', label: 'Profile' },
];

// Strip every `(group)` segment and any trailing slash so a grouped href and a
// stripped pathname reduce to the same key. A collapsed path stays '/'.
export function normalizeTabPath(path: string): string {
  const withoutGroups = path.replace(/\/\([^/]+\)/g, '');
  const trimmed = withoutGroups.replace(/\/+$/, '');
  return trimmed.length === 0 ? '/' : trimmed;
}

// Index of the tab for the current pathname. A real tab match (stripped path or
// grouped href) always wins; Home is the fallback only when nothing matches at
// all, such as a modal or a deeper route pushed over the tabs. Falling back
// before matching is what previously pinned every screen to Home.
export function resolveActiveTabIndex(pathname: string): number {
  if (!pathname) return 0;
  const normalized = normalizeTabPath(pathname);
  const index = TAB_ROUTES.findIndex(
    tab => normalizeTabPath(tab.path) === normalized || normalizeTabPath(tab.href) === normalized,
  );
  return index < 0 ? 0 : index;
}
