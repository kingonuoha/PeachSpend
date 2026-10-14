import React, { useEffect, useMemo, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { Plus } from 'lucide-react-native';
import Svg, { Path } from 'react-native-svg';
import { Colors, DarkTheme, Gradients, LightTheme, Radii, Spacing, Typography } from '../../constants/tokens';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import { computeTabRowLayout, TAB_TARGET } from './tabBarGeometry';

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

// Chassis geometry: 90 tall container holding a 76 tall chassis whose top edge
// sits at y 16, anchored around a fixed 56 FAB at bottom 24.
const CONTAINER_HEIGHT = 90;
const BAR_HEIGHT = 76;
const SCOOP_TOP = 16;
const FAB_SIZE = 56;
const FAB_RADIUS = FAB_SIZE / 2;
const FAB_BOTTOM = 24;
// Clearance kept between the FAB edge and the cradle wall. The cradle is sized
// off the FAB, so the gap is even at the trough and at the widest point, which
// is what makes the scoop read as a cradle around the button instead of a flush
// cut. Both bottom-nav references show this ring of clearance.
const SCOOP_GAP = 10;
// Explicit stacking inside the overflow-visible container: chassis 0, glow 1,
// tabs row 2, FAB 3, FAB touch target 4, speed-dial callout 5.
const FAB_Z_INDEX = 3;
const TAB_ICON_SIZE = 24;
// Icon baseline. The canonical `pb-3` (12) is measured to the icon, which puts
// the icon centre 24 above the bar's bottom edge. On device that reads as
// crowding the OS navigation bar, so the row is lifted by ICON_RAISE. The touch
// frames move with it, so the 48pt targets stay intact.
const ICON_RAISE = 10;
const TAB_ROW_PAD_BOTTOM = ICON_RAISE;
const PRESSED_SCALE = 0.94;
const FAB_PRESSED_SCALE = 0.95;
const FAB_PRESS_DURATION = 120;
// Light chassis drop-shadow offset. The locked pair is `0 8px 20px`; without an
// SVG blur the honest approximation is the chassis path copied 8 below at 0.16.
const SHADOW_OFFSET = 8;
// Speed-dial callout, anchored above the FAB as a tooltip: a surface card with a
// downward tail sitting a fixed clearance over the button, centred on it.
const CALL_OUT_GAP = 8;
const CALL_OUT_TAIL = 8;
const CALL_OUT_ACTION_WIDTH = 60;
const CALL_OUT_ICON = 40;
// Extra transparent height above the bar so the callout lives inside the
// container bounds and is never clipped on Android. Harmless: the container is
// box-none, so this area passes taps through to the screen behind.
const CALL_OUT_SPACE = 120;
// CSS 160deg gradient as unit points, matching PeachButton.
const GRADIENT_START = { x: 0.33, y: 0 };
const GRADIENT_END = { x: 0.67, y: 1 };
const GRADIENT_LOCATIONS: [number, number, number] = [0, 0.45, 1];

// Chassis-relative FAB centre, derived so it stays correct if FAB_BOTTOM moves.
const CHASSIS_TOP = CONTAINER_HEIGHT - BAR_HEIGHT;
const FAB_CENTER_Y = CONTAINER_HEIGHT - FAB_BOTTOM - FAB_RADIUS - CHASSIS_TOP;
// Cradle wall: a circle of radius FAB_RADIUS + SCOOP_GAP centred on the FAB, so
// the ring of clearance is exactly even at the trough and at the widest point.
const CRADLE_RADIUS = FAB_RADIUS + SCOOP_GAP;
const CRADLE_TROUGH = FAB_CENTER_Y + CRADLE_RADIUS;
// Shoulder flare. A circular wall crossing the flat top edge would meet it at a
// steep angle and read as a cut point, so a convex fillet turns the horizontal
// top edge into the cradle wall, tangent to both, so the edge curves out of the
// straight run instead of breaking. Its radius has a hard floor of the drop from
// the top edge to the FAB centre, which is the smallest fillet that can make
// that turn; SHOULDER_SCALE grows it past the floor for a rounder shoulder. The
// fillet is external to the cradle circle, so it never eats the ring.
const SHOULDER_MIN_RADIUS = FAB_CENTER_Y - SCOOP_TOP;
const SHOULDER_SCALE = 4.0;
const FILLET_RADIUS = SHOULDER_MIN_RADIUS * SHOULDER_SCALE;
// The fillet centre is one radius below the top edge and R + r from the FAB
// centre. Solving that pair gives its horizontal offset from the bar centre.
const FILLET_CENTER_X = Math.sqrt(
  (CRADLE_RADIUS + FILLET_RADIUS) ** 2 - (FILLET_RADIUS - SHOULDER_MIN_RADIUS) ** 2,
);
// Where the fillet meets the wall, on the line between the two centres.
const WALL_SHARE = CRADLE_RADIUS / (CRADLE_RADIUS + FILLET_RADIUS);
const WALL_MEET_X = FILLET_CENTER_X * WALL_SHARE;
const WALL_MEET_Y = FAB_CENTER_Y + (FILLET_RADIUS - SHOULDER_MIN_RADIUS) * WALL_SHARE;

// Bar outline: flat top edge, convex shoulder fillet, circular cradle wall to
// the trough, then mirrored. Only the flat run between the shoulders stretches
// with width, so the cradle and the clearance never change with screen size.
function scoopPath(width: number, height: number): string {
  const cx = width / 2;
  const start = Math.min(FILLET_CENTER_X, cx);
  const meet = Math.min(WALL_MEET_X, cx);
  return [
    `M 0 ${SCOOP_TOP}`,
    `L ${cx - start} ${SCOOP_TOP}`,
    // Convex fillet, tangent to the top edge and to the cradle wall.
    `A ${FILLET_RADIUS} ${FILLET_RADIUS} 0 0 1 ${cx - meet} ${WALL_MEET_Y}`,
    // Cradle wall, the lower part of the circle around the FAB.
    `A ${CRADLE_RADIUS} ${CRADLE_RADIUS} 0 0 0 ${cx} ${CRADLE_TROUGH}`,
    `A ${CRADLE_RADIUS} ${CRADLE_RADIUS} 0 0 0 ${cx + meet} ${WALL_MEET_Y}`,
    // Mirror fillet back onto the top edge.
    `A ${FILLET_RADIUS} ${FILLET_RADIUS} 0 0 1 ${cx + start} ${SCOOP_TOP}`,
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

  // Native-driven values, matching ScalePressable. 0 is closed, 1 is open.
  const fabOpenAnim = useState(() => new Animated.Value(0))[0];
  const fabPressAnim = useState(() => new Animated.Value(1))[0];
  const calloutAnim = useState(() => new Animated.Value(0))[0];

  useEffect(() => {
    if (reduceMotion) {
      fabOpenAnim.setValue(fabOpen ? 1 : 0);
      return;
    }
    const animation = Animated.spring(fabOpenAnim, {
      toValue: fabOpen ? 1 : 0,
      damping: 14,
      mass: 0.7,
      stiffness: 220,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [fabOpen, reduceMotion, fabOpenAnim]);

  // The callout grows out of the FAB: it rises and scales up on open and eases
  // back down on close, so the toggle never reads as an instant swap.
  useEffect(() => {
    if (reduceMotion) {
      calloutAnim.setValue(fabOpen ? 1 : 0);
      return;
    }
    const animation = Animated.spring(calloutAnim, {
      toValue: fabOpen ? 1 : 0,
      damping: 16,
      mass: 0.8,
      stiffness: 210,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [fabOpen, reduceMotion, calloutAnim]);

  const height = BAR_HEIGHT + bottomInset;
  const path = useMemo(() => (width > 0 ? scoopPath(width, height) : ''), [width, height]);
  // Scale the design icon-centre distances to the measured bar width once per
  // layout, not per frame. See tabBarGeometry.ts for the targets and the tests.
  const rowLayout = useMemo(() => computeTabRowLayout(width), [width]);
  const hasActions = !!actions?.length;
  const fabBottom = bottomInset + FAB_BOTTOM;

  // The Plus rotates to an X on open, and the disc dips under the finger.
  const rotate = fabOpenAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '45deg'] });
  const calloutTranslateY = calloutAnim.interpolate({ inputRange: [0, 1], outputRange: [10, 0] });
  const calloutScale = calloutAnim.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] });

  const pressFabIn = () => {
    if (reduceMotion) {
      fabPressAnim.setValue(FAB_PRESSED_SCALE);
      return;
    }
    Animated.timing(fabPressAnim, {
      toValue: FAB_PRESSED_SCALE,
      duration: FAB_PRESS_DURATION,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();
  };

  const pressFabOut = () => {
    if (reduceMotion) {
      fabPressAnim.setValue(1);
      return;
    }
    Animated.spring(fabPressAnim, {
      toValue: 1,
      damping: 14,
      mass: 0.7,
      stiffness: 220,
      useNativeDriver: true,
    }).start();
  };

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

  return (
    <View
      // box-none: only the icon row, the FAB touch target and the callout take
      // touches. The bar's empty surface and the callout's clearance above the
      // bar pass taps through, so the scrim behind can still dismiss the menu.
      pointerEvents="box-none"
      style={[tabStyles.container, { height: CONTAINER_HEIGHT + bottomInset + CALL_OUT_SPACE }]}
      onLayout={handleLayout}
    >
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

      <View style={[tabStyles.tabsRow, { bottom: bottomInset, paddingHorizontal: rowLayout.gutter }]}>
        <View style={[tabStyles.group, { gap: rowLayout.gap }]}>{tabs.slice(0, 2).map(renderTab)}</View>
        <View style={[tabStyles.group, { gap: rowLayout.gap }]}>{tabs.slice(2).map(renderTab)}</View>
      </View>

      {/*
        Speed-dial callout. Centred on the FAB and anchored a fixed clearance
        above it, with a downward tail, so it reads as a tooltip rising out of
        the button rather than a column pinned to the screen edge. Always
        mounted so the close animation can play; pointerEvents is off while
        closed so it never intercepts a tap.
      */}
      {hasActions ? (
        <Animated.View
          pointerEvents={fabOpen ? 'auto' : 'none'}
          style={[
            tabStyles.calloutSlot,
            { bottom: fabBottom + FAB_SIZE + CALL_OUT_GAP },
            {
              opacity: calloutAnim,
              transform: [{ translateY: calloutTranslateY }, { scale: calloutScale }],
            },
          ]}
        >
          <View
            style={[
              tabStyles.calloutCard,
              { backgroundColor: raw.surfaceContainerHigh, borderColor: raw.outline },
            ]}
          >
            {actions?.map((action) => (
              <Pressable
                key={action.key}
                accessibilityRole="button"
                accessibilityLabel={action.label}
                onPress={() => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  action.onPress();
                }}
                style={({ pressed }) => [
                  tabStyles.calloutAction,
                  pressed && !reduceMotion && tabStyles.actionPressed,
                ]}
              >
                <View style={[tabStyles.calloutIcon, { backgroundColor: action.color }]}>
                  {action.icon}
                </View>
                <Text
                  style={[Typography.labelMd, tabStyles.calloutLabel, { color: raw.onSurface }]}
                  numberOfLines={1}
                >
                  {action.label}
                </Text>
              </Pressable>
            ))}
          </View>
          <View style={[tabStyles.calloutTail, { borderTopColor: raw.surfaceContainerHigh }]} />
        </Animated.View>
      ) : null}

      {/*
        The FAB is deliberately split into a painted layer and a touch layer.
        A single absolutely-positioned Pressable carrying an Android
        `elevation` plus a transform and a style function never painted on
        device: its whole subtree stayed invisible while its SVG siblings
        painted correctly. So the visible disc is a plain (animated) View
        centred by a full-width slot, the gradient is a clipped child of it, and
        touch lives on a separate transparent target. No measured-width `left`
        and no `elevation` on the layer that has to be seen.
      */}
      <View pointerEvents="none" style={[tabStyles.fabSlot, { bottom: fabBottom }]}>
        <Animated.View
          style={[
            tabStyles.fabCircle,
            { backgroundColor: raw.primary, transform: [{ rotate }, { scale: fabPressAnim }] },
          ]}
        >
          <LinearGradient
            pointerEvents="none"
            colors={gradient}
            locations={GRADIENT_LOCATIONS}
            start={GRADIENT_START}
            end={GRADIENT_END}
            style={tabStyles.fabGradient}
          />
          <Plus size={24} color={Colors.white} strokeWidth={2.6} />
        </Animated.View>
      </View>

      {/*
        Transparent 56pt hit target over the disc. Centred with left 50% and a
        half-width negative margin so it never depends on the measured bar
        width, and 56 wide keeps it clear of the two icon pairs.
      */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Log transaction"
        accessibilityState={{ expanded: fabOpen }}
        onPress={() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          onFabPress();
        }}
        onPressIn={pressFabIn}
        onPressOut={pressFabOut}
        style={[tabStyles.fabHit, { bottom: fabBottom }]}
      />
    </View>
  );
}

const tabStyles = StyleSheet.create({
  container: {
    width: '100%',
    overflow: 'visible',
  },
  // Explicit stacking so the scoop chassis can never composite over the FAB on a
  // device: chassis 0, tabs row 2, FAB 3, hit target 4, callout 5.
  chassis: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    overflow: 'visible',
    zIndex: 0,
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
  // Full-width transparent slot that centers the callout on the bar with no
  // measured width, above the FAB.
  calloutSlot: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 5,
  },
  // Surface card defined by fill plus hairline, not elevation, so it cannot hit
  // the Android paint failure the old FAB did.
  calloutCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.s3,
    padding: Spacing.s3,
    borderRadius: Radii.lg,
    borderWidth: 1,
  },
  calloutAction: {
    width: CALL_OUT_ACTION_WIDTH,
    alignItems: 'center',
    gap: Spacing.s1,
  },
  calloutIcon: {
    width: CALL_OUT_ICON,
    height: CALL_OUT_ICON,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calloutLabel: {
    textAlign: 'center',
  },
  // Downward tail, drawn with the border triangle trick so no asset is needed.
  calloutTail: {
    width: 0,
    height: 0,
    borderLeftWidth: CALL_OUT_TAIL,
    borderRightWidth: CALL_OUT_TAIL,
    borderTopWidth: CALL_OUT_TAIL,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  // Full-width transparent slot that centers the FAB disc without reading the
  // measured bar width. zIndex keeps the disc above the scoop chassis (0), the
  // glow (1) and the icon row (2).
  fabSlot: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: FAB_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: FAB_Z_INDEX,
  },
  // The painted disc. A plain (animated) View: no elevation, no style function,
  // so it cannot be dropped the way the previous Pressable was. overflow hidden
  // plus the radius keeps the gradient child inside the circle.
  fabCircle: {
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_RADIUS,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  // Decorative gradient overlay under the icon. An explicit absolute fill keeps
  // the native gradient view from collapsing to zero size, and it owns the
  // radius clip so the overlay stays a circle.
  fabGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: FAB_RADIUS,
  },
  // Transparent touch target over the disc. left 50% plus a half-width negative
  // margin centers it with no measured width, and 56 wide keeps it clear of the
  // two icon pairs.
  fabHit: {
    position: 'absolute',
    left: '50%',
    marginLeft: -FAB_RADIUS,
    width: FAB_SIZE,
    height: FAB_SIZE,
    zIndex: FAB_Z_INDEX + 1,
  },
  actionPressed: {
    transform: [{ scale: FAB_PRESSED_SCALE }],
  },
});
