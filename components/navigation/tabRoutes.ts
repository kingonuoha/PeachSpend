// The tab routes for the `(tabs)` group, shared by the tab bar layout and its
// test. Expo Router strips route groups such as `(tabs)` from usePathname()
// (see expo-router build/global-state/getRouteInfoFromState.js, which filters
// segments wrapped in parentheses), so the active tab is matched on the
// normalized `path`, never the navigation `href`. Matching on the href left
// every tab except Home permanently inactive.
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

// Index of the tab for the current pathname, defaulting to Home when no tab
// matches (a modal or a deeper route pushed over the tabs).
export function resolveActiveTabIndex(pathname: string): number {
  const index = TAB_ROUTES.findIndex(tab => tab.path === pathname);
  return index < 0 ? 0 : index;
}
