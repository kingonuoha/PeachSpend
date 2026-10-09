import React, { useEffect, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Filter, Search, X } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import { LightTheme, Radii, Spacing, Typography } from '../../constants/tokens';

const EXPAND_DURATION = 180;
const PILL_MIN_HEIGHT = 46;
const TRIGGER_SIZE = 40;
const CLEAR_VISUAL = 20;
const CLEAR_TOUCH = 44;
// HTML gap-1.5 (6) has no spacing token; kept as a fluid gap value, not a fixed size.
const CHIP_GAP = 6;
// Visual chip is about 22 high; vertical hitSlop lifts the effective target to 44.
const CHIP_VERTICAL_HIT_SLOP = 11;

export type SearchFilterChipTone = 'applied' | 'active' | 'default';

export interface SearchFilterChip {
  id: string;
  label: string;
  tone?: SearchFilterChipTone;
  onPress?: () => void;
  onRemove?: () => void;
}

export interface SearchFilterBarProps {
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  query: string;
  onQueryChange: (query: string) => void;
  placeholder?: string;
  chips?: SearchFilterChip[];
  resultCount?: number;
  resultLabel?: string;
  totalLabel?: string;
  onOpenFilters?: () => void;
  autoFocus?: boolean;
}

function feedback() {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

// Collapsed state control: a 40px circular trigger with a 48pt touch area via hitSlop.
function RoundTrigger({ label, onPress, children }: { label: string; onPress: () => void; children: React.ReactNode }) {
  const ts = useThemeStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => {
        feedback();
        onPress();
      }}
      hitSlop={4}
      style={({ pressed }) => [
        triggerStyles.circle,
        { backgroundColor: ts.bg.surface, borderColor: pressed ? ts.raw.primary : ts.raw.outline },
        !ts.isDark && triggerStyles.shadow,
      ]}
    >
      {children}
    </Pressable>
  );
}

function FilterChipButton({ chip }: { chip: SearchFilterChip }) {
  const ts = useThemeStyles();
  const tone = chip.tone ?? 'default';
  const isApplied = tone === 'applied';
  const isActive = tone === 'active';
  const labelColor = isApplied ? ts.raw.onPrimary : isActive ? ts.raw.primary : ts.text.onSurfaceVariant;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={chip.label}
      accessibilityState={{ selected: isApplied || isActive }}
      onPress={() => {
        feedback();
        chip.onPress?.();
      }}
      hitSlop={{ top: CHIP_VERTICAL_HIT_SLOP, bottom: CHIP_VERTICAL_HIT_SLOP }}
      style={({ pressed }) => [
        chipStyles.chip,
        {
          backgroundColor: isApplied ? ts.raw.primary : isActive ? ts.raw.purple100 : ts.bg.low,
          borderColor: isApplied || isActive ? 'transparent' : ts.raw.outline,
        },
        isApplied && !ts.isDark && chipStyles.chipShadow,
        pressed && chipStyles.chipPressed,
      ]}
    >
      <Text numberOfLines={1} style={[Typography.labelMd, isApplied || isActive ? chipStyles.chipBold : chipStyles.chipMedium, { color: labelColor }]}>
        {chip.label}
      </Text>
      {chip.onRemove ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove ${chip.label} filter`}
          onPress={() => {
            feedback();
            chip.onRemove?.();
          }}
          hitSlop={12}
          style={chipStyles.chipRemove}
        >
          <X size={10} color={isApplied ? ts.raw.onPrimary : ts.raw.primary} strokeWidth={3} />
        </Pressable>
      ) : null}
    </Pressable>
  );
}

// Canonical shared search and filter control. Presentational: the caller owns the
// query pipeline, filtering, debounce, and all result data.
export function SearchFilterBar({
  expanded,
  onExpandedChange,
  query,
  onQueryChange,
  placeholder = 'Search transactions',
  chips,
  resultCount,
  resultLabel = 'matching transactions found',
  totalLabel,
  onOpenFilters,
  autoFocus,
}: SearchFilterBarProps) {
  const ts = useThemeStyles();
  const reduceMotion = useReduceMotion();
  const [progress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!expanded) {
      progress.setValue(0);
      return;
    }
    if (reduceMotion) {
      progress.setValue(1);
      return;
    }
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: EXPAND_DURATION,
      // CSS "180ms ease" is cubic-bezier(0.25, 0.1, 0.25, 1).
      easing: Easing.bezier(0.25, 0.1, 0.25, 1),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [expanded, reduceMotion, progress]);

  if (!expanded) {
    return (
      <View style={styles.triggerRow}>
        <RoundTrigger label="Search transactions" onPress={() => onExpandedChange(true)}>
          <Search size={20} color={ts.raw.primary} />
        </RoundTrigger>
        {onOpenFilters ? (
          <RoundTrigger label="Open filters" onPress={onOpenFilters}>
            <Filter size={16} color={ts.text.onSurfaceVariant} />
          </RoundTrigger>
        ) : null}
      </View>
    );
  }

  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [-4, 0] });

  return (
    <Animated.View style={[styles.expandedBlock, { opacity: progress, transform: [{ translateY }] }]}>
      <View style={[styles.pill, { backgroundColor: ts.bg.low, borderColor: ts.raw.primary }, !ts.isDark && styles.pillShadow]}>
        <View pointerEvents="none" style={styles.searchIcon}>
          <Search size={16} color={ts.raw.primary} strokeWidth={2.2} />
        </View>
        <TextInput
          value={query}
          onChangeText={onQueryChange}
          placeholder={placeholder}
          placeholderTextColor={ts.text.onSurfaceVariant}
          selectionColor={ts.raw.primary}
          autoFocus={autoFocus}
          returnKeyType="search"
          accessibilityLabel="Search transactions"
          style={[Typography.bodyRegular, styles.input, styles.inputBold, { color: ts.text.onSurface }]}
        />
        {query.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            onPress={() => {
              feedback();
              onQueryChange('');
            }}
            hitSlop={4}
            style={styles.clearBox}
          >
            <View style={[styles.clearVisual, { backgroundColor: ts.bg.surfaceContainerHighest }]}>
              <X size={11} color={ts.text.onSurfaceVariant} strokeWidth={3} />
            </View>
          </Pressable>
        ) : null}
      </View>
      {chips && chips.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          style={styles.chipScroll}
          contentContainerStyle={styles.chipRow}
        >
          {chips.map((chip) => (
            <FilterChipButton key={chip.id} chip={chip} />
          ))}
        </ScrollView>
      ) : null}
      {resultCount !== undefined ? (
        <View style={[styles.resultRow, { borderTopColor: ts.raw.outline }]}>
          <Text
            accessibilityLiveRegion="polite"
            numberOfLines={1}
            style={[Typography.micro, styles.resultCount, { color: ts.text.onSurfaceVariant }]}
          >
            {`${resultCount} ${resultLabel}`}
          </Text>
          {totalLabel ? (
            <Text numberOfLines={1} style={[Typography.micro, styles.resultTotal, { color: ts.raw.primary }]}>
              {totalLabel}
            </Text>
          ) : null}
        </View>
      ) : null}
    </Animated.View>
  );
}

const triggerStyles = StyleSheet.create({
  circle: {
    width: TRIGGER_SIZE,
    height: TRIGGER_SIZE,
    borderRadius: Radii.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shadow: {
    shadowColor: LightTheme.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 3,
  },
});

const chipStyles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s1,
    paddingHorizontal: Spacing.s3,
    paddingVertical: Spacing.s1,
    borderRadius: Radii.full,
    borderWidth: 1,
  },
  chipBold: { fontFamily: 'Manrope_700Bold' },
  chipMedium: { fontFamily: 'Manrope_500Medium' },
  chipShadow: {
    shadowColor: LightTheme.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 2,
  },
  chipPressed: { transform: [{ scale: 0.97 }] },
  chipRemove: { alignItems: 'center', justifyContent: 'center' },
});

const styles = StyleSheet.create({
  triggerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.s2 },
  expandedBlock: { width: '100%' },
  pill: {
    width: '100%',
    minHeight: PILL_MIN_HEIGHT,
    borderRadius: Radii.full,
    borderWidth: 2,
    paddingLeft: 40,
    paddingRight: 40,
    flexDirection: 'row',
    alignItems: 'center',
  },
  pillShadow: {
    shadowColor: LightTheme.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 3,
  },
  searchIcon: { position: 'absolute', left: 14, top: 0, bottom: 0, justifyContent: 'center' },
  input: { flex: 1, minHeight: PILL_MIN_HEIGHT - 4, paddingVertical: 0, textAlignVertical: 'center' },
  inputBold: { fontFamily: 'Manrope_700Bold' },
  clearBox: {
    position: 'absolute',
    // 44pt press box centered on the design's right-3.5 (14) visual inset.
    right: 2,
    top: 0,
    bottom: 0,
    width: CLEAR_TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearVisual: {
    width: CLEAR_VISUAL,
    height: CLEAR_VISUAL,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipScroll: { marginTop: Spacing.s3 },
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: CHIP_GAP, paddingBottom: Spacing.s1 },
  resultRow: {
    marginTop: Spacing.s3,
    paddingTop: Spacing.s3,
    borderTopWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.s2,
  },
  resultCount: { flexShrink: 1 },
  resultTotal: { fontFamily: 'Manrope_700Bold' },
});
