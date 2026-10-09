import React, { useState } from 'react';
import { Pressable, ScrollView, Text } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import { getCurrencyPrefix } from '../../utils/currency';
import { Radii, Spacing, Typography } from '../../constants/tokens';

interface EntryCurrencyPickerProps {
  value: string;
  options: string[];
  onSelect: (currency: string) => void;
  /** Pills pinned before the + More control. The selected currency is always shown. */
  maxVisible?: number;
}

// Canonical Picker A: the lightweight inline pill selector used for a single
// entry. Codes and symbols are fully data-driven; nothing financial is fixed here.
export function EntryCurrencyPicker({ value, options, onSelect, maxVisible = 3 }: EntryCurrencyPickerProps) {
  const ts = useThemeStyles();
  const [expanded, setExpanded] = useState(false);

  if (options.length === 0) return null;

  const limit = Math.max(1, maxVisible);
  const collapsed = options.slice(0, limit);
  if (!expanded && !collapsed.includes(value) && options.includes(value)) {
    collapsed[collapsed.length - 1] = value;
  }
  const visible = expanded ? options : collapsed;
  const hasMore = !expanded && options.length > limit;

  const select = (code: string) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onSelect(code);
  };

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.s2, paddingBottom: Spacing.s1 }}
      accessibilityRole="radiogroup"
      accessibilityLabel="Currency"
    >
      {visible.map((code) => {
        const selected = code === value;
        return (
          <Pressable
            key={code}
            onPress={() => select(code)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={`Currency ${code}`}
            hitSlop={{ top: Spacing.s2, bottom: Spacing.s2 }}
            style={({ pressed }) => ({
              minHeight: 36,
              flexDirection: 'row',
              alignItems: 'center',
              gap: Spacing.s1,
              paddingHorizontal: Spacing.s3,
              paddingVertical: Spacing.s1,
              borderRadius: Radii.full,
              borderWidth: 1,
              borderColor: selected ? ts.raw.primary : ts.raw.outline,
              backgroundColor: selected ? ts.raw.primary : pressed ? ts.raw.purple100 : ts.bg.low,
              // HTML selected pill carries shadow-sm; dark replaces shadow with border per design system 5a.
              ...(selected && !ts.isDark
                ? { shadowColor: ts.raw.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.12, shadowRadius: 12, elevation: 3 }
                : null),
            })}
          >
            <Text style={[Typography.captionBold, { fontFamily: selected ? 'Manrope_700Bold' : 'Manrope_600SemiBold', color: selected ? ts.text.white : ts.text.onSurface }]}>{code}</Text>
            <Text style={[Typography.micro, { color: selected ? ts.text.white + 'CC' : ts.text.onSurfaceVariant }]}>{getCurrencyPrefix(code)}</Text>
          </Pressable>
        );
      })}
      {hasMore ? (
        <Pressable
          onPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setExpanded(true);
          }}
          accessibilityRole="button"
          accessibilityLabel="More currencies"
          hitSlop={{ top: Spacing.s2, bottom: Spacing.s2 }}
          style={({ pressed }) => ({
            minHeight: 36,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: Spacing.s3,
            paddingVertical: Spacing.s1,
            borderRadius: Radii.full,
            borderWidth: 1,
            borderColor: ts.raw.outline,
            backgroundColor: pressed ? ts.raw.purple100 : ts.bg.low,
          })}
        >
          <Text style={[Typography.captionBold, { color: ts.text.primary }]}>+ More</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}
