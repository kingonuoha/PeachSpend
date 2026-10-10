import { describe, expect, it } from 'vitest';
import { normalizeTabPath, resolveActiveTabIndex, TAB_ROUTES } from './tabRoutes';

describe('tab bar active route resolution', () => {
  it('matches the normalized pathname expo-router reports for each tab', () => {
    expect(resolveActiveTabIndex('/')).toBe(0);
    expect(resolveActiveTabIndex('/analytics')).toBe(1);
    expect(resolveActiveTabIndex('/chat')).toBe(2);
    expect(resolveActiveTabIndex('/profile')).toBe(3);
  });

  it('matches a grouped href too, so resolution survives either pathname form', () => {
    // Some expo-router versions and deep links surface the group in the
    // pathname. Matching on the stripped path alone left those screens pinned
    // to Home, so the grouped href must resolve to its own tab.
    expect(resolveActiveTabIndex('/(tabs)/analytics')).toBe(1);
    expect(resolveActiveTabIndex('/(tabs)/chat')).toBe(2);
    expect(resolveActiveTabIndex('/(tabs)/profile')).toBe(3);
    expect(resolveActiveTabIndex('/(tabs)')).toBe(0);
    expect(resolveActiveTabIndex('/(tabs)/')).toBe(0);
  });

  it('ignores a trailing slash on either form', () => {
    expect(resolveActiveTabIndex('/profile/')).toBe(3);
  });

  it('defaults to Home only when no tab matches at all', () => {
    expect(resolveActiveTabIndex('/settings')).toBe(0);
    expect(resolveActiveTabIndex('/scan')).toBe(0);
    expect(resolveActiveTabIndex('')).toBe(0);
  });

  it('normalizes a group prefix away without collapsing a real path', () => {
    expect(normalizeTabPath('/(tabs)/profile')).toBe('/profile');
    expect(normalizeTabPath('/profile/')).toBe('/profile');
    expect(normalizeTabPath('/(tabs)')).toBe('/');
    expect(normalizeTabPath('/')).toBe('/');
    expect(normalizeTabPath('/(tabs)/chat/history')).toBe('/chat/history');
  });

  it('keeps each tab href and path consistent with the route group', () => {
    expect(TAB_ROUTES.map(tab => tab.href)).toEqual(['/(tabs)', '/(tabs)/analytics', '/(tabs)/chat', '/(tabs)/profile']);
    expect(TAB_ROUTES.map(tab => tab.path)).toEqual(['/', '/analytics', '/chat', '/profile']);
  });
});
