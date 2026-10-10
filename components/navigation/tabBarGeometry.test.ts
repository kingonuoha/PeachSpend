import { describe, expect, it } from 'vitest';
import {
  computeTabRowLayout,
  DESIGN_BAR_WIDTH,
  DESIGN_OUTER_CENTER,
  DESIGN_PAIR_CENTER,
  firstIconCenter,
  pairIconCenterGap,
  TAB_TARGET,
} from './tabBarGeometry';

describe('tab bar row geometry', () => {
  it('reduces to the spec_8 targets at the canonical 350 width', () => {
    const layout = computeTabRowLayout(DESIGN_BAR_WIDTH);
    expect(layout.scale).toBe(1);
    expect(layout.gutter).toBe(6);
    expect(layout.gap).toBe(8);
    expect(firstIconCenter(layout)).toBe(28);
    expect(pairIconCenterGap(layout)).toBe(52);
  });

  it('keeps the icon centers at the design fractions across phone widths', () => {
    for (const width of [320, 390, 430]) {
      const layout = computeTabRowLayout(width);
      const center = firstIconCenter(layout);
      const gap = pairIconCenterGap(layout);
      // Clamped scale is width / 350 until the 1.35 ceiling.
      expect(layout.scale).toBeCloseTo(width / DESIGN_BAR_WIDTH, 6);
      expect(center).toBeCloseTo(DESIGN_OUTER_CENTER * layout.scale, 6);
      expect(gap).toBeCloseTo(DESIGN_PAIR_CENTER * layout.scale, 6);
    }
  });

  it('never overflows the bar at 320, 390, 430 or a tablet width', () => {
    for (const width of [320, 390, 430, 768]) {
      const layout = computeTabRowLayout(width);
      // Two pairs of two 44pt targets plus the in-pair gap, plus both gutters.
      const used = 2 * layout.gutter + 2 * (2 * TAB_TARGET + layout.gap);
      expect(layout.gutter).toBeGreaterThanOrEqual(0);
      expect(layout.gap).toBeGreaterThanOrEqual(0);
      expect(used).toBeLessThanOrEqual(width);
    }
  });

  it('clamps the scale at the extremes so the row stays legible', () => {
    expect(computeTabRowLayout(100).scale).toBe(0.85);
    expect(computeTabRowLayout(2000).scale).toBe(1.35);
    expect(computeTabRowLayout(0).scale).toBe(1);
  });
});
