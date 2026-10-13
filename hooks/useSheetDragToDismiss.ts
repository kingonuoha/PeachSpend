import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import * as Haptics from 'expo-haptics';

// Sheet motion values from POLISH.md Section 4. constants/animations.ts defines
// mass/stiffness springs, not the duration-based sheet spring the recipe uses, so
// the canonical sheet values live here once for every sheet.
const EASE_SHEET = Easing.bezier(0.32, 0.72, 0, 1);
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const ENTER_DURATION = 300;
const EXIT_DURATION = 200;
const SNAP_BACK_SPRING = { duration: 400, dampingRatio: 0.8 } as const;
const DISMISS_SPRING = { duration: 300, dampingRatio: 0.8, overshootClamping: true } as const;
// Fraction of the sheet travel that commits a dismiss. Velocity can commit sooner.
const DISMISS_PROGRESS = 0.4;
const RUBBERBAND_CONSTANT = 0.55;

// RECIPES.md worklets. Both run on the UI thread, so both carry the directive.
function project(velocity: number, decelerationRate = 0.998): number {
  'worklet';
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

function rubberband(overshoot: number, dimension: number, constant = RUBBERBAND_CONSTANT): number {
  'worklet';
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

function snapHaptic() {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

export interface UseSheetDragToDismissOptions {
  /**
   * Full vertical travel in points: the sheet's own height, or the window height.
   * Also the end of the backdrop fade, so the sheet fades as it leaves.
   */
  height: number;
  /** Presented state. Drives the entry/exit translate so the slide-up is preserved. */
  visible: boolean;
  /** Platform reduce-motion preference. Drops the drag translate and the dismiss overshoot. */
  reduceMotion: boolean;
  /**
   * Whether a drag may dismiss right now. When false the drag still follows the
   * finger but snaps back and reports a block instead of dismissing.
   */
  dismissable?: boolean;
  /** Runs on the RN thread after a drag dismissal has animated off-screen. */
  onDismiss: () => void;
  /** Runs on the RN thread when a drag dismissal is refused. */
  onBlocked?: () => void;
}

/**
 * Shared drag-to-dismiss behaviour for bottom sheets. Works for both an RN
 * `Modal` (mount it inside its own `GestureHandlerRootView`) and an absolute
 * overlay. Owns the sheet's `translateY`: it animates the entry/exit from the
 * `visible` prop, tracks the finger on a memoised `Gesture.Pan`, and derives the
 * backdrop opacity from the same value so the two can never desync.
 */
export function useSheetDragToDismiss({
  height,
  visible,
  reduceMotion,
  dismissable = true,
  onDismiss,
  onBlocked,
}: UseSheetDragToDismissOptions) {
  // 0 is resting; height is fully off-screen.
  const translateY = useSharedValue(height);
  // Where the finger grabbed the sheet, so grabbing mid-animation does not teleport.
  const dragStart = useSharedValue(0);

  // Latest callbacks without rebuilding the gesture (a reattached recogniser would
  // drop a drag that is already in flight).
  const onDismissRef = useRef(onDismiss);
  const onBlockedRef = useRef(onBlocked);
  useEffect(() => {
    onDismissRef.current = onDismiss;
    onBlockedRef.current = onBlocked;
  }, [onDismiss, onBlocked]);

  const fireDismiss = useCallback(() => { onDismissRef.current(); }, []);
  const fireBlocked = useCallback(() => {
    snapHaptic();
    onBlockedRef.current?.();
  }, []);

  const pan = useMemo(() => Gesture.Pan()
    // Vertical axis declared so a horizontal swipe can still win.
    .activeOffsetY([-10, 10])
    .onStart(() => {
      dragStart.set(translateY.get());
    })
    .onUpdate((event) => {
      // Reduced motion drops the drag translate; the drag still decides a dismiss.
      if (reduceMotion) return;
      const next = dragStart.get() + event.translationY;
      // Downward is free; upward past the top resists.
      translateY.set(next >= 0 ? next : rubberband(next, height));
    })
    .onEnd((event) => {
      const travelled = reduceMotion ? event.translationY : translateY.get();
      const projected = travelled + project(event.velocityY);
      const wantsDismiss = projected > height * DISMISS_PROGRESS;

      if (wantsDismiss && dismissable) {
        if (reduceMotion) {
          // Reduced fallback: no slide, no overshoot, but the dismiss still fires.
          translateY.set(height);
          scheduleOnRN(fireDismiss);
        } else {
          // Velocity is handed to the spring, and overshootClamping stops the sheet
          // springing past the bottom edge and flashing a gap.
          translateY.set(withSpring(height, { ...DISMISS_SPRING, velocity: event.velocityY }, (finished) => {
            if (finished) scheduleOnRN(fireDismiss);
          }));
        }
        return;
      }

      if (wantsDismiss) {
        if (!reduceMotion) translateY.set(withSpring(0, { ...SNAP_BACK_SPRING, velocity: event.velocityY }));
        scheduleOnRN(fireBlocked);
        return;
      }

      if (!reduceMotion) translateY.set(withSpring(0, { ...SNAP_BACK_SPRING, velocity: event.velocityY }));
      scheduleOnRN(snapHaptic);
    }), [dismissable, dragStart, fireBlocked, fireDismiss, height, reduceMotion, translateY]);

  // Entry/exit. The sheet stays mounted until this settles, so the perceived
  // slide-up is preserved when the native Modal animation is disabled.
  useEffect(() => {
    if (visible) {
      translateY.set(reduceMotion ? 0 : withTiming(0, { duration: ENTER_DURATION, easing: EASE_SHEET }));
    } else {
      translateY.set(reduceMotion ? height : withTiming(height, { duration: EXIT_DURATION, easing: EASE_OUT }));
    }
  }, [visible, height, reduceMotion, translateY]);

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.get() }],
  }));

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateY.get(), [0, height], [1, 0], Extrapolation.CLAMP),
  }), [height]);

  return { translateY, pan, sheetStyle, backdropStyle };
}
