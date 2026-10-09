import React from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { Check, Info, Plus, Search, SearchX, X } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import { CategoryTints, Colors, Radii, Spacing, Typography } from '../../constants/tokens';
import { CategoryGlyph } from './CategoryGlyph';

export interface CaptureCategory {
  id: string;
  title: string;
  icon_name?: string;
  /** Caller-formatted label under the tile: per-category amount, or a custom hint. */
  meta?: string;
}

export interface CategoryPickerGridProps {
  categories: CaptureCategory[];
  selectedId?: string;
  onSelect: (category: CaptureCategory) => void;
  /** Selection-only callers omit this. When present, renders the custom tile. */
  onRequestCustom?: () => void;
  customLabel?: string;
  customHint?: string;
  /** Optional override of the canonical empty-search body line. */
  emptyLabel?: string;
  /** Controlled search value. Omit to let the grid own its query state. */
  query?: string;
  onQueryChange?: (value: string) => void;
  /** Standalone grids render the search; the sheet renders it in its own fixed section. */
  showSearch?: boolean;
}

const TILE_SHADOW = {
  shadowColor: Colors.black,
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.12,
  shadowRadius: 12,
  elevation: 3,
} as const;

const PRESS_SCALE = 0.95;
const SELECTED_SCALE = 1.05;

function pressFeedback() {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

function CategorySearchBar({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  const ts = useThemeStyles();
  const [focused, setFocused] = React.useState(false);
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 44,
        borderRadius: Radii.full,
        backgroundColor: ts.bg.elevated,
        borderWidth: 1,
        borderColor: focused ? ts.raw.primary : 'transparent',
        paddingLeft: Spacing.s3,
      }}
    >
      <Search size={16} color={ts.icon.muted} />
      <TextInput
        value={value}
        onChangeText={onChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        placeholderTextColor={ts.text.onSurfaceVariant}
        selectionColor={ts.raw.primary}
        style={{ flex: 1, marginLeft: Spacing.s2, color: ts.text.onSurface, ...Typography.labelMd }}
        accessibilityLabel="Search categories"
        returnKeyType="search"
      />
      {value ? (
        <Pressable
          onPress={() => { pressFeedback(); onChange(''); }}
          accessibilityRole="button"
          accessibilityLabel="Clear category search"
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
        >
          <View style={{ width: 20, height: 20, borderRadius: Radii.full, backgroundColor: ts.bg.surfaceContainerHighest, alignItems: 'center', justifyContent: 'center' }}>
            <X size={12} color={ts.icon.muted} />
          </View>
        </Pressable>
      ) : (
        <View style={{ width: 44, height: 44 }} />
      )}
    </View>
  );
}

function CategoryEmptyState({ query, emptyLabel }: { query: string; emptyLabel?: string }) {
  const ts = useThemeStyles();
  return (
    <View style={{ alignItems: 'center', paddingVertical: Spacing.s8, paddingHorizontal: Spacing.s4 }}>
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: Radii.md,
          backgroundColor: ts.bg.primary10,
          borderWidth: 1,
          borderColor: ts.border.primary20,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: Spacing.s3,
        }}
      >
        <SearchX size={24} color={ts.raw.primary} />
      </View>
      <Text style={[Typography.labelBold, { color: ts.text.onSurface, textAlign: 'center' }]}>No category found</Text>
      <Text style={[Typography.labelMd, { color: ts.text.onSurfaceVariant, textAlign: 'center', marginTop: Spacing.s1, maxWidth: 240 }]}>
        {emptyLabel ?? `No matching category for "${query}". Try a different search term.`}
      </Text>
      <View
        style={{
          marginTop: Spacing.s4,
          flexDirection: 'row',
          alignItems: 'center',
          gap: Spacing.s2,
          padding: Spacing.s3,
          borderRadius: Radii.sm,
          backgroundColor: ts.bg.primary5,
          borderWidth: 1,
          borderColor: ts.border.primary20,
        }}
      >
        <Info size={14} color={ts.raw.primary} />
        <Text style={[Typography.micro, { color: ts.raw.primary, flex: 1 }]}>
          To create new categories, navigate to Manage Categories (S-16) in Settings.
        </Text>
      </View>
    </View>
  );
}

// Canonical category selection surface: pill search, then a hard 4-column grid of
// tinted icon chips with label and meta. Selection-only; it never creates or edits.
export function CategoryPickerGrid({
  categories,
  selectedId,
  onSelect,
  onRequestCustom,
  customLabel = 'Custom',
  customHint = 'Create',
  emptyLabel,
  query,
  onQueryChange,
  showSearch = true,
}: CategoryPickerGridProps) {
  const [internalQuery, setInternalQuery] = React.useState('');
  const isControlled = query !== undefined;
  const value = isControlled ? query : internalQuery;
  const setValue = (next: string) => {
    if (isControlled) onQueryChange?.(next);
    else setInternalQuery(next);
  };
  const trimmed = value.trim().toLowerCase();
  const filtered = trimmed ? categories.filter((category) => category.title.toLowerCase().includes(trimmed)) : categories;

  return (
    <View>
      {showSearch ? (
        <View style={{ marginBottom: Spacing.s4 }}>
          <CategorySearchBar value={value} onChange={setValue} placeholder={onRequestCustom ? 'Search categories or add custom' : 'Search categories'} />
        </View>
      ) : null}

      {filtered.length === 0 && !onRequestCustom ? (
        <CategoryEmptyState query={value} emptyLabel={emptyLabel} />
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }} accessibilityRole="radiogroup">
          {filtered.map((category) => (
            <CategoryTile
              key={category.id}
              category={category}
              selected={category.id === selectedId}
              onPress={() => { pressFeedback(); onSelect(category); }}
            />
          ))}
          {onRequestCustom ? (
            <CustomTile label={customLabel} hint={customHint} onPress={() => { pressFeedback(); onRequestCustom(); }} />
          ) : null}
        </View>
      )}
    </View>
  );
}

function CategoryTile({ category, selected, onPress }: { category: CaptureCategory; selected: boolean; onPress: () => void }) {
  const ts = useThemeStyles();
  const tint = CategoryTints[category.id as keyof typeof CategoryTints] ?? CategoryTints.other;
  const iconColor = ts.isDark ? tint.dark[1] : tint.light[1];
  const background = ts.isDark ? tint.dark[0] : tint.light[0];

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={category.title}
      style={({ pressed }) => ({
        width: '25%',
        alignItems: 'center',
        paddingHorizontal: Spacing.s1,
        marginBottom: Spacing.s4,
        transform: [{ scale: pressed ? PRESS_SCALE : selected ? SELECTED_SCALE : 1 }],
      })}
    >
      <View
        pointerEvents="none"
        style={{
          width: 56,
          height: 56,
          borderRadius: Radii.md,
          backgroundColor: background,
          alignItems: 'center',
          justifyContent: 'center',
          // Pair selected state is a 2px purple ring drawn 2px outside the chip
          // (CSS outline + outline-offset), keeping the tinted chip background.
          // Ring color is primaryBorder: purple-600 light, purple-400 dark.
          ...(selected ? { outlineWidth: 2, outlineColor: ts.raw.primaryBorder, outlineOffset: 2, outlineStyle: 'solid' as const } : null),
          // Pair base chips are flat; only the selected chip carries shadow-md.
          ...(selected && !ts.isDark ? TILE_SHADOW : null),
        }}
      >
        <CategoryGlyph iconName={category.icon_name} size={24} color={iconColor} />
        {selected ? (
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: Radii.full, backgroundColor: ts.raw.primary, borderWidth: 1, borderColor: ts.isDark ? ts.raw.surface : Colors.white, alignItems: 'center', justifyContent: 'center' }}>
            <Check size={11} color={Colors.white} strokeWidth={3} />
          </View>
        ) : null}
      </View>
      <Text
        numberOfLines={1}
        style={[Typography.labelMd, { marginTop: Spacing.s1, color: selected ? ts.raw.primary : ts.text.onSurface, fontFamily: selected ? 'Manrope_700Bold' : 'Manrope_500Medium', maxWidth: '100%', textAlign: 'center' }]}
      >
        {category.title}
      </Text>
      {category.meta ? (
        <Text numberOfLines={1} style={[Typography.micro, { color: ts.text.onSurfaceVariant, maxWidth: '100%', textAlign: 'center' }]}>{category.meta}</Text>
      ) : null}
    </Pressable>
  );
}

function CustomTile({ label, hint, onPress }: { label: string; hint: string; onPress: () => void }) {
  const ts = useThemeStyles();
  const tint = CategoryTints.other;
  const iconColor = ts.isDark ? tint.dark[1] : tint.light[1];
  const background = ts.isDark ? tint.dark[0] : tint.light[0];

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        width: '25%',
        alignItems: 'center',
        paddingHorizontal: Spacing.s1,
        marginBottom: Spacing.s4,
        transform: [{ scale: pressed ? PRESS_SCALE : 1 }],
      })}
    >
      <View
        pointerEvents="none"
        style={{
          width: 56,
          height: 56,
          borderRadius: Radii.md,
          backgroundColor: background,
          borderWidth: 1,
          borderStyle: 'dashed',
          borderColor: ts.text.onSurfaceVariant,
          alignItems: 'center',
          justifyContent: 'center',
          ...(ts.isDark ? null : TILE_SHADOW),
        }}
      >
        <Plus size={24} color={iconColor} strokeWidth={2} />
      </View>
      <Text numberOfLines={1} style={[Typography.labelMd, { marginTop: Spacing.s1, color: ts.text.onSurface, fontFamily: 'Manrope_500Medium', maxWidth: '100%', textAlign: 'center' }]}>{label}</Text>
      <Text numberOfLines={1} style={[Typography.micro, { color: ts.text.onSurfaceVariant, maxWidth: '100%', textAlign: 'center' }]}>{hint}</Text>
    </Pressable>
  );
}

type FlowType = 'expense' | 'income';

interface CategoryPickerSheetProps extends CategoryPickerGridProps {
  visible: boolean;
  onClose: () => void;
  /** Which capture flow invoked the picker; tints the type badge and accent. */
  flowType?: FlowType;
  /** Live origin context, e.g. the merchant or income source. Omitted shows a neutral subtitle. */
  originLabel?: string;
  /** Live caller-formatted amount, e.g. `formatCurrency(amount, currency)`. */
  originAmount?: string;
}

export function CategoryPickerSheet({ visible, onClose, flowType = 'expense', originLabel, originAmount, ...grid }: CategoryPickerSheetProps) {
  const ts = useThemeStyles();
  const reduceMotion = useReduceMotion();
  const { height } = useWindowDimensions();
  const [query, setQuery] = React.useState('');
  const [wasVisible, setWasVisible] = React.useState(visible);

  // Reset the search when the sheet transitions closed, without setState in an
  // effect body: derive on the visible edge during render.
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (!visible && query) setQuery('');
  }

  const isIncome = flowType === 'income';
  const accentColor = isIncome ? ts.raw.successText : ts.text.primary;
  const badgeBackground = isIncome ? ts.raw.successContainer : ts.raw.purple100;
  const maxSheetHeight = Math.min(height * 0.92, 760);
  const maxGridHeight = Math.min(height * 0.5, 380);

  const handleClose = () => {
    setQuery('');
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType={reduceMotion ? 'none' : 'slide'} onRequestClose={handleClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: ts.bg.overlay }} accessibilityViewIsModal>
        <Pressable style={{ flex: 1 }} onPress={handleClose} accessibilityRole="button" accessibilityLabel="Dismiss category picker" />
        <View
          accessibilityLabel="Category picker"
          style={{
            width: '100%',
            maxWidth: 640,
            alignSelf: 'center',
            maxHeight: maxSheetHeight,
            backgroundColor: ts.raw.surface,
            borderTopLeftRadius: Radii.xl,
            borderTopRightRadius: Radii.xl,
            borderTopWidth: 1,
            borderColor: ts.border.card,
            paddingTop: Spacing.s3,
            overflow: 'hidden',
          }}
        >
          <View style={{ alignItems: 'center', paddingBottom: Spacing.s1 }}>
            <View style={{ width: 40, height: 4, borderRadius: Radii.full, backgroundColor: ts.raw.outline }} />
          </View>

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: Spacing.s3,
              paddingHorizontal: Spacing.s5,
              paddingTop: Spacing.s1,
              paddingBottom: Spacing.s3,
              borderBottomWidth: 1,
              borderBottomColor: ts.border.subtle,
            }}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.s2, flexWrap: 'wrap' }}>
                <Text style={[Typography.headlineMd, { color: ts.text.onSurface }]}>Select Category</Text>
                <View style={{ paddingHorizontal: Spacing.s2, paddingVertical: 2, borderRadius: Radii.full, backgroundColor: badgeBackground }}>
                  <Text style={[Typography.micro, { fontFamily: 'Manrope_700Bold', textTransform: 'uppercase', color: accentColor }]}>{isIncome ? 'Income' : 'Expense'}</Text>
                </View>
              </View>
              <Text numberOfLines={2} style={[Typography.labelMd, { color: ts.text.onSurfaceVariant, marginTop: 2 }]}>
                {originLabel ? (
                  <>Choose category for <Text style={{ fontFamily: 'Manrope_600SemiBold', color: accentColor }}>{originLabel}{originAmount ? ` (${originAmount})` : ''}</Text></>
                ) : 'Selection only. Returns to entry.'}
              </Text>
            </View>
            <Pressable
              onPress={() => { pressFeedback(); handleClose(); }}
              accessibilityRole="button"
              accessibilityLabel="Close category picker"
              style={{ width: 44, height: 44, borderRadius: Radii.full, backgroundColor: ts.bg.surfaceContainerHighest, borderWidth: 1, borderColor: ts.border.card, alignItems: 'center', justifyContent: 'center' }}
            >
              <X size={16} color={ts.icon.muted} />
            </Pressable>
          </View>

          <View style={{ paddingHorizontal: Spacing.s5, paddingVertical: Spacing.s3, borderBottomWidth: 1, borderBottomColor: ts.border.subtle, backgroundColor: ts.bg.screen }}>
            <CategorySearchBar value={query} onChange={setQuery} placeholder="Search categories..." />
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            style={{ flexShrink: 1, maxHeight: maxGridHeight }}
            contentContainerStyle={{ paddingHorizontal: Spacing.s5, paddingVertical: Spacing.s4 }}
          >
            <CategoryPickerGrid {...grid} query={query} onQueryChange={setQuery} showSearch={false} />
          </ScrollView>

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: Spacing.s2,
              paddingHorizontal: Spacing.s5,
              paddingVertical: Spacing.s3,
              backgroundColor: ts.bg.screen,
              borderTopWidth: 1,
              borderTopColor: ts.border.subtle,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.s2, flexShrink: 1 }}>
              <View style={{ width: 8, height: 8, borderRadius: Radii.full, backgroundColor: ts.raw.primary }} />
              <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant }]}>Selection-only surface</Text>
            </View>
            <Text style={[Typography.micro, { color: ts.text.primary }]}>Auto-returns on tap</Text>
          </View>
        </View>
      </View>
    </Modal>
  );
}
