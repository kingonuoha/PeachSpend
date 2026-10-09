import React, { useEffect, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { Delete } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import { Colors, LightTheme, Radii, Spacing, Typography } from '../../constants/tokens';

const KEY_ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['.', '0', 'delete'],
] as const;

// Locked pair draws the decimal key as a bullet. The glyph is visual only: the key
// still emits '.' so the S-09/S-11 decimal handlers stay unchanged.
const DECIMAL_GLYPH = '\u2022';
const CURSOR_HEIGHT = 32;
const MIN_KEY_HEIGHT = 54;

export interface VirtualNumpadProps {
  onKeyPress: (key: string) => void;
  value?: string;
  currencySymbol?: string;
  entryLabel?: string;
  statusLabel?: string;
  pressedKeyPreview?: string;
  pressBadgeLabel?: string;
}

function Cursor({ color, reduceMotion }: { color: string; reduceMotion: boolean }) {
  const [opacity] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (reduceMotion) {
      opacity.setValue(1);
      return;
    }
    // Matches the pair's Tailwind `animate-pulse`: 2s cycle, opacity 1 to 0.5 and back.
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.5, duration: 1000, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 1000, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity, reduceMotion]);
  return <Animated.View pointerEvents="none" style={[numpadStyles.cursor, { backgroundColor: color, opacity }]} />;
}

function NumpadKey({ valueKey, onPress, previewPressed, badgeLabel }: { valueKey: string; onPress: (key: string) => void; previewPressed: boolean; badgeLabel?: string }) {
  const ts = useThemeStyles();
  const accessibilityLabel = valueKey === 'delete' ? 'Delete last digit' : valueKey === '.' ? 'Decimal point' : `Enter ${valueKey}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={() => onPress(valueKey)}
      style={({ pressed }) => {
        const active = pressed || previewPressed;
        return [
          numpadStyles.key,
          { backgroundColor: active ? ts.raw.purple100 : ts.bg.surface, borderColor: active ? ts.raw.primary : ts.raw.outline },
          !ts.isDark && (active ? numpadStyles.keyActiveShadow : numpadStyles.keyShadow),
          active && numpadStyles.keyActive,
        ];
      }}
    >
      {({ pressed }) => {
        const active = pressed || previewPressed;
        return (
          <>
            {valueKey === 'delete'
              ? <Delete size={24} strokeWidth={2.2} color={active ? ts.raw.primary : ts.icon.error} />
              : <Text style={[valueKey === '.' ? numpadStyles.bullet : Typography.numpadKey, { color: active ? ts.raw.primary : valueKey === '.' ? ts.text.onSurfaceVariant : ts.text.onSurface }]}>{valueKey === '.' ? DECIMAL_GLYPH : valueKey}</Text>}
            {previewPressed && badgeLabel ? <View pointerEvents="none" style={[numpadStyles.badge, { backgroundColor: ts.raw.primary }]}><Text style={numpadStyles.badgeText}>{badgeLabel}</Text></View> : null}
          </>
        );
      }}
    </Pressable>
  );
}

export function VirtualNumpad({ onKeyPress, value, currencySymbol, entryLabel = 'Current Entry', statusLabel, pressedKeyPreview, pressBadgeLabel }: VirtualNumpadProps) {
  const ts = useThemeStyles();
  const reduceMotion = useReduceMotion();
  const press = (key: string) => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onKeyPress(key); };

  return (
    <View style={numpadStyles.root}>
      {value !== undefined ? (
        <View style={[numpadStyles.display, { backgroundColor: ts.bg.surface, borderColor: ts.raw.outline }, !ts.isDark && numpadStyles.displayShadow]}>
          <Text style={[Typography.labelMd, numpadStyles.entryLabel, { color: ts.text.onSurfaceVariant }]}>{entryLabel}</Text>
          <View style={numpadStyles.amountRow}>
            {currencySymbol ? <Text style={[Typography.headlineSm, { color: ts.raw.primary, marginRight: Spacing.s1 }]}>{currencySymbol}</Text> : null}
            <Text style={[Typography.displayLg, { color: ts.text.onSurface }]}>{value}</Text>
            <Cursor color={ts.raw.primary} reduceMotion={reduceMotion} />
          </View>
          {statusLabel ? <View style={[numpadStyles.statusPill, { backgroundColor: ts.isDark ? ts.bg.elevated : ts.bg.low }]}><Text style={[Typography.micro, { color: ts.text.onSurfaceVariant }]}>{statusLabel}</Text></View> : null}
        </View>
      ) : null}
      <View accessibilityLabel="Amount keypad" style={[numpadStyles.pad, { backgroundColor: ts.bg.surface, borderColor: ts.raw.outline }, !ts.isDark && numpadStyles.padShadow]}>
        {KEY_ROWS.map((row) => (
          <View key={row.join('-')} style={numpadStyles.row}>
            {row.map((valueKey) => <NumpadKey key={valueKey} valueKey={valueKey} onPress={press} previewPressed={valueKey === pressedKeyPreview} badgeLabel={pressBadgeLabel} />)}
          </View>
        ))}
      </View>
    </View>
  );
}

const numpadStyles = StyleSheet.create({
  root: { width: '100%', maxWidth: 420, alignSelf: 'center', gap: Spacing.s4 },
  display: { borderWidth: 1, borderRadius: Radii.xl, padding: Spacing.s4, alignItems: 'center' },
  displayShadow: { shadowColor: LightTheme.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.12, shadowRadius: 12, elevation: 3 },
  entryLabel: { fontFamily: 'Manrope_500Medium', marginBottom: Spacing.s1 },
  amountRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  cursor: { width: 2, height: CURSOR_HEIGHT, borderRadius: 1, marginLeft: 2 },
  statusPill: { marginTop: Spacing.s2, flexDirection: 'row', alignItems: 'center', gap: Spacing.s1, paddingHorizontal: Spacing.s3, paddingVertical: Spacing.s1, borderRadius: Radii.full },
  pad: { borderWidth: 1, borderRadius: Radii.xl, padding: Spacing.s4, gap: Spacing.s3 },
  padShadow: { shadowColor: LightTheme.primary, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.16, shadowRadius: 24, elevation: 6 },
  row: { flexDirection: 'row', gap: Spacing.s3 },
  key: { flex: 1, minHeight: MIN_KEY_HEIGHT, borderRadius: Radii.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  keyShadow: { shadowColor: LightTheme.primary, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 1 },
  keyActiveShadow: { shadowColor: LightTheme.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 12, elevation: 3 },
  keyActive: { transform: [{ scale: 0.94 }] },
  bullet: { fontFamily: 'Manrope_700Bold', fontSize: 20, lineHeight: 24 },
  badge: { position: 'absolute', top: -6, right: -6, borderRadius: Radii.full, paddingHorizontal: 6, paddingVertical: 1 },
  badgeText: { color: Colors.white, fontFamily: 'Manrope_700Bold', fontSize: 9, lineHeight: 11 },
});
