import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { Plus } from 'lucide-react-native';
import Svg, { Circle, Defs, Path, RadialGradient, Stop } from 'react-native-svg';
import { Colors, DarkTheme, Gradients, LightTheme, Radii, Spacing, Typography } from '../../constants/tokens';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import { useThemeStyles } from '../../hooks/useThemeStyles';

type TabIcon = React.ComponentType<{ size?: number; color?: string }>;
type Tone = 'auto' | 'light' | 'dark';

export interface PeachTabItem {
  key: string;
  label: string;
  icon: TabIcon;
}

export interface PeachTabAction {
  key: string;
  label: string;
  icon: React.ReactNode;
  color: string;
  onPress: () => void;
}

interface PeachTabBarProps {
  tabs: PeachTabItem[];
  activeKey: string;
  onSelect: (key: string) => void;
  onFabPress: () => void;
  fabOpen?: boolean;
  actions?: PeachTabAction[];
  bottomInset?: number;
  tone?: Tone;
}

// Canonical geometry from code.html: 90 tall container, 76 tall chassis whose
// top edge sits at y 16 and whose scoop floor reaches y 50, anchored around a
// fixed 56 FAB at bottom 24.
const CONTAINER_HEIGHT = 90;
const BAR_HEIGHT = 76;
const SCOOP_TOP = 16;
const SCOOP_FLOOR = 50;
const FAB_SIZE = 56;
const FAB_RADIUS = FAB_SIZE / 2;
const FAB_BOTTOM = 24;
// Explicit stacking inside the overflow-visible container: chassis 0, glow 1,
// tabs row 2, FAB 3, speed dial 4. The FAB must sit above the scoop SVG on both
// platforms regardless of sibling paint order.
const FAB_Z_INDEX = 3;
const TAB_TARGET = 44;
const TAB_ICON_SIZE = 24;
// Canonical bar geometry from code.html: the bar is 350 wide (viewBox line 66),
// each outer icon center is 28 from the bar edge (px-4 16 plus the 12 half icon,
// line 85), and the two icons in a pair are 52 apart (24 icon plus gap-7 28,
// lines 87 and 99). The app bar is the full window width, so those design
// distances are scaled by width / 350 and clamped, then converted from icon
// centers to the 44pt frame: subtract half the target for the edge gutter, the
// full target for the pair gap. At scale 1 this reduces to gutter 6, gap 8.
const DESIGN_BAR_WIDTH = 350;
const DESIGN_OUTER_CENTER = 28;
const DESIGN_PAIR_CENTER = 52;
const LAYOUT_SCALE_MIN = 0.85;
const LAYOUT_SCALE_MAX = 1.35;
// The canonical `pb-3` (12) is measured to the icon. A 44pt box adds 10 below
// the 24 icon, so the box bottom sits at 12 - 10 = 2.
const TAB_ROW_PAD_BOTTOM = 2;
const PRESSED_SCALE = 0.94;
const FAB_PRESSED_SCALE = 0.95;
const ACTION_SIZE = 48;
// Dark FAB glow radius, from the locked `0 0 24px rgba(145,99,245,0.45)` glow-lg.
// Rendered as a real radial SVG so it survives Android, where elevation cannot
// carry the purple color and native shadow is iOS only.
const FAB_GLOW_RADIUS = 24;
// Light chassis drop-shadow offset. The locked pair is `0 8px 20px`; without an
// SVG blur the honest approximation is the chassis path copied 8 below at 0.16.
const SHADOW_OFFSET = 8;
// CSS 160deg gradient as unit points, matching PeachButton.
const GRADIENT_START = { x: 0.33, y: 0 };
const GRADIENT_END = { x: 0.67, y: 1 };
const GRADIENT_LOCATIONS: [number, number, number] = [0, 0.45, 1];

// Fixed scoop offsets from center so the notch hugs the 56 FAB while only the
// straight shoulders stretch with width.
function scoopPath(width: number, height: number): string {
  const cx = width / 2;
  const left = Math.max(0, cx - 50);
  const right = Math.min(width, cx + 50);
  return [
    `M 0 ${SCOOP_TOP}`,
    `L ${left} ${SCOOP_TOP}`,
    `C ${cx - 35} ${SCOOP_TOP} ${cx - 31} 20 ${cx - 25} 32`,
    `C ${cx - 19} 44 ${cx - 13} ${SCOOP_FLOOR} ${cx} ${SCOOP_FLOOR}`,
    `C ${cx + 13} ${SCOOP_FLOOR} ${cx + 19} 44 ${cx + 25} 32`,
    `C ${cx + 31} 20 ${cx + 35} ${SCOOP_TOP} ${right} ${SCOOP_TOP}`,
    `L ${width} ${SCOOP_TOP}`,
    `L ${width} ${height}`,
    `L 0 ${height}`,
    'Z',
  ].join(' ');
}

export function PeachTabBar({
  tabs,
  activeKey,
  onSelect,
  onFabPress,
  fabOpen = false,
  actions,
  bottomInset = 0,
  tone = 'auto',
}: PeachTabBarProps) {
  const ts = useThemeStyles();
  const reduceMotion = useReduceMotion();
  const isDark = tone === 'auto' ? ts.isDark : tone === 'dark';
  const raw = isDark ? DarkTheme : LightTheme;
  const gradient = isDark ? Gradients.dark : Gradients.light;
  const [width, setWidth] = useState(0);

  const height = BAR_HEIGHT + bottomInset;
  const path = useMemo(() => (width > 0 ? scoopPath(width, height) : ''), [width, height]);
  // Scale the design icon-center distances to the measured bar width once per
  // layout, not per frame. The gutter and gap are frame values for the 44pt
  // targets, so the 24pt icons land on the design fractions 0.080, 0.229,
  // 0.771, 0.920 across phone widths. Floored at 0 so targets cannot overlap.
  const rowLayout = useMemo(() => {
    const scale = width > 0
      ? Math.min(LAYOUT_SCALE_MAX, Math.max(LAYOUT_SCALE_MIN, width / DESIGN_BAR_WIDTH))
      : 1;
    return {
      gutter: Math.max(0, DESIGN_OUTER_CENTER * scale - TAB_TARGET / 2),
      gap: Math.max(0, DESIGN_PAIR_CENTER * scale - TAB_TARGET),
    };
  }, [width]);
  const dialVisible = fabOpen && !!actions?.length;

  const handleLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    if (next !== width) setWidth(next);
  };

  const renderTab = (tab: PeachTabItem) => {
    const active = tab.key === activeKey;
    const Icon = tab.icon;
    return (
      <Pressable
        key={tab.key}
        accessibilityRole="tab"
        accessibilityLabel={tab.label}
        accessibilityState={{ selected: active }}
        onPress={() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onSelect(tab.key);
        }}
        style={({ pressed }) => [tabStyles.tab, pressed && !reduceMotion && tabStyles.pressed]}
      >
        <Icon size={TAB_ICON_SIZE} color={active ? raw.primary : raw.onSurfaceVariant} />
      </Pressable>
    );
  };

  const glowSize = FAB_SIZE + FAB_GLOW_RADIUS * 2;

  return (
    <View
      style={[tabStyles.container, { height: CONTAINER_HEIGHT + bottomInset }]}
      onLayout={handleLayout}
    >
      {dialVisible ? (
        <View style={[tabStyles.actions, { bottom: bottomInset + FAB_BOTTOM + FAB_SIZE + Spacing.s4 }]}>
          {actions?.map((action) => (
            <View key={action.key} style={tabStyles.actionItem}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={action.label}
                onPress={() => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  action.onPress();
                }}
                style={({ pressed }) => [
                  tabStyles.action,
                  { backgroundColor: action.color },
                  pressed && !reduceMotion && tabStyles.actionPressed,
                ]}
              >
                {action.icon}
              </Pressable>
              <Text style={[Typography.labelMd, tabStyles.actionLabel]}>{action.label}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {width > 0 ? (
        <View style={[tabStyles.chassis, { height }]} pointerEvents="none">
          {!isDark ? (
            <Svg width={width} height={height + SHADOW_OFFSET} style={tabStyles.shadowLayer}>
              <Path
                d={path}
                fill={`${LightTheme.primary}29`}
                transform={`translate(0, ${SHADOW_OFFSET})`}
              />
            </Svg>
          ) : null}
          <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
            <Path
              d={path}
              fill={raw.surface}
              stroke={isDark ? raw.outline : 'transparent'}
              strokeWidth={isDark ? 1 : 0}
            />
          </Svg>
        </View>
      ) : null}

      {width > 0 && isDark ? (
        <Svg
          width={glowSize}
          height={glowSize}
          pointerEvents="none"
          style={[
            tabStyles.glow,
            {
              left: width / 2 - glowSize / 2,
              bottom: bottomInset + FAB_BOTTOM - FAB_GLOW_RADIUS,
            },
          ]}
        >
          <Defs>
            <RadialGradient id="fabGlow" cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor={raw.primary} stopOpacity={0.45} />
              <Stop offset="100%" stopColor={raw.primary} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={glowSize / 2} cy={glowSize / 2} r={glowSize / 2} fill="url(#fabGlow)" />
        </Svg>
      ) : null}

      <View style={[tabStyles.tabsRow, { bottom: bottomInset, paddingHorizontal: rowLayout.gutter }]}>
        <View style={[tabStyles.group, { gap: rowLayout.gap }]}>{tabs.slice(0, 2).map(renderTab)}</View>
        <View style={[tabStyles.group, { gap: rowLayout.gap }]}>{tabs.slice(2).map(renderTab)}</View>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Log transaction"
        accessibilityState={{ expanded: fabOpen }}
        onPress={() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          onFabPress();
        }}
        style={({ pressed }) => [
          tabStyles.fab,
          {
            left: width / 2 - FAB_SIZE / 2,
            bottom: bottomInset + FAB_BOTTOM,
            // Solid locked-token fallback painted directly on the FAB so the
            // button is visible even if the gradient layer fails to lay out.
            backgroundColor: raw.primary,
            shadowColor: isDark ? 'transparent' : raw.primary,
            shadowOffset: { width: 0, height: isDark ? 0 : 10 },
            shadowOpacity: isDark ? 0 : 0.35,
            shadowRadius: 24,
            // Dark keeps a small elevation so the FAB stays on its own Android
            // layer above the scoop SVG; the purple glow comes from the radial
            // layer, so the elevation shadow is transparent.
            elevation: isDark ? 2 : 10,
          },
          pressed && !reduceMotion && tabStyles.fabPressed,
        ]}
      >
        <LinearGradient
          colors={gradient}
          locations={GRADIENT_LOCATIONS}
          start={GRADIENT_START}
          end={GRADIENT_END}
          style={tabStyles.fabGradient}
        >
          <View style={{ transform: [{ rotate: fabOpen ? '45deg' : '0deg' }] }}>
            <Plus size={24} color={Colors.white} strokeWidth={2.6} />
          </View>
        </LinearGradient>
      </Pressable>
    </View>
  );
}

const tabStyles = StyleSheet.create({
  container: {
    width: '100%',
    overflow: 'visible',
  },
  // Explicit stacking so the scoop chassis can never composite over the FAB on a
  // device: chassis 0, glow 1, tabs row 2, FAB 3, speed dial 4.
  chassis: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    overflow: 'visible',
    zIndex: 0,
  },
  glow: {
    position: 'absolute',
    zIndex: 1,
  },
  // Shadow layer is taller than the chassis so the 8pt offset copy is not
  // clipped by the SVG viewport, matching the pair's drop-shadow.
  shadowLayer: {
    position: 'absolute',
    left: 0,
    top: 0,
  },
  tabsRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: BAR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingBottom: TAB_ROW_PAD_BOTTOM,
    zIndex: 2,
  },
  group: {
    flexDirection: 'row',
  },
  tab: {
    width: TAB_TARGET,
    height: TAB_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    transform: [{ scale: PRESSED_SCALE }],
  },
  fab: {
    position: 'absolute',
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_RADIUS,
    zIndex: FAB_Z_INDEX,
  },
  fabPressed: {
    transform: [{ scale: FAB_PRESSED_SCALE }],
  },
  // The gradient is the FAB's painted circle. It gets an explicit fill
  // (absoluteFill over the 56x56 FAB) instead of flex sizing, so the native
  // gradient view can never collapse to zero size, and it owns the radius clip
  // so the circle stays round while the plus icon is centered inside it.
  fabGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: FAB_RADIUS,
    overflow: 'hidden',
  },
  actions: {
    position: 'absolute',
    right: Spacing.s5,
    alignItems: 'center',
    gap: Spacing.s3,
    zIndex: 4,
  },
  actionItem: {
    alignItems: 'center',
  },
  action: {
    width: ACTION_SIZE,
    height: ACTION_SIZE,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionPressed: {
    transform: [{ scale: FAB_PRESSED_SCALE }],
  },
  actionLabel: {
    color: Colors.white,
    marginTop: Spacing.s1,
  },
});
