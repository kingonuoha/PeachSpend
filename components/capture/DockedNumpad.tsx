import React from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { Spacing } from '../../constants/tokens';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import { VirtualNumpad } from './VirtualNumpad';

// Phase 11 DEC-11-01. The one docked-numpad surface both entry screens mount.
//
// It is a layout sibling of the action bar, never an overlay, so it cannot cover a
// field or the actions at any scroll position. When a text field takes focus the
// caller removes it from the tree and the native keyboard owns the bottom instead.
//
// The key height is derived from the viewport and clamped: a tall screen keeps the
// full key, a short one comes down to the pair's own 44pt key, which is also the
// touch floor. One clamp for both screens, so they cannot drift apart.

const MIN_KEY_HEIGHT = 44;
const MAX_KEY_HEIGHT = 54;
// Share of the viewport height a key may take. At 844pt this reaches the maximum and
// at 568pt it is already at the floor, so the clamp does the real work.
const KEY_HEIGHT_RATIO = 0.075;

export function dockedKeyHeight(viewportHeight: number): number {
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return MIN_KEY_HEIGHT;
  return Math.max(MIN_KEY_HEIGHT, Math.min(MAX_KEY_HEIGHT, Math.round(viewportHeight * KEY_HEIGHT_RATIO)));
}

export function DockedNumpad({ onKeyPress }: { onKeyPress: (key: string) => void }) {
  const ts = useThemeStyles();
  const { height } = useWindowDimensions();
  return (
    <View style={[styles.dock, { backgroundColor: ts.bg.surface, borderTopColor: ts.border.subtle }]}>
      <VirtualNumpad onKeyPress={onKeyPress} keyHeight={dockedKeyHeight(height)} />
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    paddingHorizontal: Spacing.s4,
    paddingTop: Spacing.s3,
    borderTopWidth: 1,
  },
});
