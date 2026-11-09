import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  computeTabRowLayout,
  DESIGN_BAR_WIDTH,
  DESIGN_OUTER_CENTER,
  DESIGN_PAIR_CENTER,
  firstIconCenter,
  pairIconCenterGap,
  TAB_BAR_HEIGHT,
  tabBarOccupiedHeight,
  TAB_TARGET,
} from './tabBarGeometry';

describe('tab bar row geometry', () => {
  it('reduces to the spec_8 targets at the canonical 350 width', () => {
    const layout = computeTabRowLayout(DESIGN_BAR_WIDTH);
    expect(layout.scale).toBe(1);
    expect(layout.gutter).toBe(4);
    expect(layout.gap).toBe(4);
    expect(firstIconCenter(layout)).toBe(28);
    expect(pairIconCenterGap(layout)).toBe(52);
  });

  it('holds the icon centers at the design target across phone widths', () => {
    for (const width of [320, 390, 430]) {
      const layout = computeTabRowLayout(width);
      const designCenter = DESIGN_OUTER_CENTER * layout.scale;
      const designGap = DESIGN_PAIR_CENTER * layout.scale;
      // Clamped scale is width / 350 until the 1.35 ceiling.
      expect(layout.scale).toBeCloseTo(width / DESIGN_BAR_WIDTH, 6);
      // The touch frame can only widen the spacing, never compress it below the
      // design center, which is exact wherever the frame is not the binding
      // constraint.
      expect(firstIconCenter(layout)).toBeCloseTo(Math.max(TAB_TARGET / 2, designCenter), 6);
      expect(pairIconCenterGap(layout)).toBeCloseTo(Math.max(TAB_TARGET, designGap), 6);
    }
  });

  it('never overflows the bar at 320, 390, 430 or a tablet width', () => {
    for (const width of [320, 390, 430, 768]) {
      const layout = computeTabRowLayout(width);
      // Two pairs of two 48pt targets plus the in-pair gap, plus both gutters.
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

describe('tab bar occupied height', () => {
  it('is the bar container the pair draws, with the safe area added at the anchor', () => {
    // The bar's own height is the spec_8 90 tall container. This is the value
    // every screen inside the tabs group clears, so it is pinned here.
    expect(TAB_BAR_HEIGHT).toBe(90);
    expect(tabBarOccupiedHeight(0)).toBe(90);
    expect(tabBarOccupiedHeight(34)).toBe(124);
    // Android reporting no inset must not shrink the bar.
    expect(tabBarOccupiedHeight(0)).toBe(TAB_BAR_HEIGHT);
  });

  it('is consumed by the bar itself rather than copied as a literal', () => {
    // The bar must read the exported geometry, so a future change to
    // TAB_BAR_HEIGHT moves the bar and every screen's clearance together. A
    // reintroduced local container-height literal is exactly the drift this row
    // exists to remove, so the source is checked directly. Vitest runs from the
    // app root, so the path is resolved from the working directory.
    const source = readFileSync(resolve(process.cwd(), 'components', 'navigation', 'PeachTabBar.tsx'), 'utf8');
    expect(source).toContain("from './tabBarGeometry'");
    expect(source).toContain('TAB_BAR_HEIGHT');
    expect(source).toContain('tabBarOccupiedHeight');
    expect(source).not.toMatch(/CONTAINER_HEIGHT\s*=/);
  });
});
