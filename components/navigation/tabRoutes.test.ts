import { describe, expect, it } from 'vitest';
import { TAB_ROUTES, resolveActiveTabIndex } from './tabRoutes';

describe('tab bar active route resolution', () => {
  it('matches the normalized pathname expo-router reports for each tab', () => {
    expect(resolveActiveTabIndex('/')).toBe(0);
    expect(resolveActiveTabIndex('/analytics')).toBe(1);
    expect(resolveActiveTabIndex('/chat')).toBe(2);
    expect(resolveActiveTabIndex('/profile')).toBe(3);
  });

  it('never matches a grouped href, which expo-router strips from the pathname', () => {
    // Regression: the pathname is '/profile', not '/(tabs)/profile', so matching
    // on the href left every tab except Home permanently inactive.
    expect(TAB_ROUTES.some(tab => tab.path === '/(tabs)/profile')).toBe(false);
    expect(resolveActiveTabIndex('/(tabs)/profile')).toBe(0);
  });

  it('defaults to Home for a route that is not a tab', () => {
    expect(resolveActiveTabIndex('/settings')).toBe(0);
    expect(resolveActiveTabIndex('/scan')).toBe(0);
  });

  it('keeps each tab href and path consistent with the route group', () => {
    expect(TAB_ROUTES.map(tab => tab.href)).toEqual(['/(tabs)', '/(tabs)/analytics', '/(tabs)/chat', '/(tabs)/profile']);
    expect(TAB_ROUTES.map(tab => tab.path)).toEqual(['/', '/analytics', '/chat', '/profile']);
  });
});
