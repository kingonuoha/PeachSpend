// Canonical tab-bar geometry from spec_8 code.html. The bar is a 350 wide
// viewBox (code.html line 66), each outer icon center sits 28 from the bar edge
// (px-4 16 plus the 12 half icon, line 85), and the two icons in a pair are 52
// apart (24 icon plus gap-7 28, lines 87 and 99). The app bar is the full window
// width, so the design distances scale by width / 350 and clamp so extreme
// widths stay legible, then convert from icon centers to the touch frame:
// subtract half the target for the edge gutter and the full target for the pair
// gap. At scale 1 with the 48pt target this reduces to gutter 4, gap 4, and icon
// centers still 28 and 80, so the visible spacing is unchanged.
//
// Kept pure and free of React Native imports so the design targets are unit
// tested directly, without a renderer.
export const DESIGN_BAR_WIDTH = 350;
export const DESIGN_OUTER_CENTER = 28;
export const DESIGN_PAIR_CENTER = 52;

// Minimum touch target. The design icon centers are held fixed; only the
// invisible hit frame grows, and it is kept at the Android 48dp minimum so the
// primary navigation row clears the smallest target both platforms allow. The
// 24pt icon is centered inside it, which is what the gutter and gap conversions
// below account for.
export const TAB_TARGET = 48;

// The scale is clamped so the outer gutter never collapses on a narrow screen
// and the pair never drifts to the far corners on a tablet.
export const LAYOUT_SCALE_MIN = 0.85;
export const LAYOUT_SCALE_MAX = 1.35;

export interface TabRowLayout {
  // width / DESIGN_BAR_WIDTH, clamped.
  scale: number;
  // Horizontal padding for the icon row, so the first icon center lands at
  // DESIGN_OUTER_CENTER * scale from the bar edge.
  gutter: number;
  // Gap between the two icon frames in a pair, so their centers land
  // DESIGN_PAIR_CENTER * scale apart.
  gap: number;
}

export function computeTabRowLayout(width: number): TabRowLayout {
  const scale = width > 0
    ? Math.min(LAYOUT_SCALE_MAX, Math.max(LAYOUT_SCALE_MIN, width / DESIGN_BAR_WIDTH))
    : 1;
  return {
    scale,
    gutter: Math.max(0, DESIGN_OUTER_CENTER * scale - TAB_TARGET / 2),
    gap: Math.max(0, DESIGN_PAIR_CENTER * scale - TAB_TARGET),
  };
}

// Distance from the bar edge to the first icon center for a given layout.
export function firstIconCenter(layout: TabRowLayout): number {
  return layout.gutter + TAB_TARGET / 2;
}

// Distance between the two icon centers in a pair for a given layout.
export function pairIconCenterGap(layout: TabRowLayout): number {
  return TAB_TARGET + layout.gap;
}
