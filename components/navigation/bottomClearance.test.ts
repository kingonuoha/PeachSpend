import { describe, expect, it } from 'vitest';
import { TAB_BAR_HEIGHT, tabBarOccupiedHeight } from './tabBarGeometry';
import { isInTabsGroup, resolveBottomClearance, TABS_GROUP_SEGMENT } from './bottomClearance';

describe('bottom clearance for the floating tab bar', () => {
  it('adds the bar on top of the safe area inside the tabs group', () => {
    for (const inset of [0, 24, 34, 48]) {
      expect(resolveBottomClearance(true, inset)).toBe(TAB_BAR_HEIGHT + inset);
      expect(resolveBottomClearance(true, inset)).toBe(tabBarOccupiedHeight(inset));
    }
    // A device reporting no inset still clears the bar's own height.
    expect(resolveBottomClearance(true, 0)).toBe(90);
  });

  it('gives the safe area only outside the tabs group, so no dead space is added', () => {
    for (const inset of [0, 24, 34, 48]) {
      expect(resolveBottomClearance(false, inset)).toBe(inset);
    }
    // The pushed chat host on a device with no inset gains nothing at all.
    expect(resolveBottomClearance(false, 0)).toBe(0);
  });

  it('is strictly larger inside the tabs group than outside it', () => {
    expect(resolveBottomClearance(true, 34)).toBeGreaterThan(resolveBottomClearance(false, 34));
  });

  it('drops the bar clearance while the keyboard is open, so no dead space sits above it', () => {
    for (const inset of [0, 24, 34, 48]) {
      // The bar is behind the keyboard and cannot be seen, so only the safe area
      // is reserved, which is the value a pushed screen already resolves to.
      expect(resolveBottomClearance(true, inset, true)).toBe(inset);
      expect(resolveBottomClearance(true, inset, true)).toBe(resolveBottomClearance(false, inset));
    }
    expect(resolveBottomClearance(true, 34, true)).toBe(34);
  });

  it('keeps the bar clearance while the keyboard is closed, so the reported defect stays fixed', () => {
    for (const inset of [0, 24, 34, 48]) {
      expect(resolveBottomClearance(true, inset, false)).toBe(TAB_BAR_HEIGHT + inset);
      // The default is the closed keyboard, so a caller that passes nothing is
      // the one the composer's reported defect needed.
      expect(resolveBottomClearance(true, inset)).toBe(TAB_BAR_HEIGHT + inset);
    }
    expect(resolveBottomClearance(true, 34, false)).toBe(124);
  });

  it('leaves a screen outside the tabs group on the safe area with the keyboard open or closed', () => {
    for (const inset of [0, 24, 34, 48]) {
      expect(resolveBottomClearance(false, inset, true)).toBe(inset);
      expect(resolveBottomClearance(false, inset, false)).toBe(inset);
    }
  });

  it('reads the group from the segment list, which is how the two chat hosts differ', () => {
    // The chat tab: the tab bar pushes its grouped href, so the group is present.
    expect(isInTabsGroup(['(tabs)', 'chat'])).toBe(true);
    expect(isInTabsGroup(['(tabs)', 'settings'])).toBe(true);
    expect(isInTabsGroup(['(tabs)'])).toBe(true);
    // The pushed stack route: `/chat` reaches app/chat.tsx with no group, which
    // is why a pushed chat screen must not gain the bar allowance.
    expect(isInTabsGroup(['chat'])).toBe(false);
    expect(isInTabsGroup(['import'])).toBe(false);
    expect(isInTabsGroup(['expense', '[id]'])).toBe(false);
    expect(isInTabsGroup([])).toBe(false);
  });

  it('pins the group segment name to the one the tab routes use', () => {
    expect(TABS_GROUP_SEGMENT).toBe('(tabs)');
  });
});
