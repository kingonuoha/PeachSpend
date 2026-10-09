import React, { useState } from 'react';
import {
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewProps,
  ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { Check, Info, Sparkles, ThumbsUp, X } from 'lucide-react-native';
import { cssInterop } from 'react-native-css-interop';

import { useThemeStyles } from '../../hooks/useThemeStyles';
import { Colors, Gradients, LightTheme, Radii, Spacing, Typography } from '../../constants/tokens';

// Shared card module. LuminousCard is the surface primitive; StatCard,
// TextCard and PickerSheet are its named variants (restructuring brief D-8),
// sharing tokens instead of forking a second card implementation.

type LuminousCardVariant = 'low' | 'high' | 'highest';

export interface LuminousCardProps extends ViewProps {
  children: React.ReactNode;
  variant?: LuminousCardVariant;
  className?: string;
}

export const LuminousCard: React.FC<LuminousCardProps> = ({
  children,
  variant = 'high',
  className = '',
  style,
  ...props
}) => {
  const ts = useThemeStyles();

  const backgrounds: Record<LuminousCardVariant, string> = {
    low: ts.bg.low,
    high: ts.bg.card,
    highest: ts.bg.elevated,
  };

  return (
    <View
      className={`overflow-hidden ${className}`}
      style={[
        styles.base,
        { backgroundColor: backgrounds[variant], borderColor: ts.raw.outline },
        style,
      ]}
      {...props}
    >
      {children}
    </View>
  );
};

// 160deg CSS gradient as unit start/end points, matching PeachButton.
const GRADIENT_START = { x: 0.33, y: 0 };
const GRADIENT_END = { x: 0.67, y: 1 };
const GRADIENT_LOCATIONS: [number, number, number] = [0, 0.45, 1];

const GLOW_SIZE = 144;
// Compact chips and the circular close keep their small visual height and earn
// the remainder of the 44pt target through hitSlop.
const CHIP_HIT_SLOP = { top: 10, bottom: 10, left: 4, right: 4 };
const CLOSE_HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 };

function triggerHaptic() {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

export interface StatCardProps {
  label: string;
  amount: string;
  badge?: string;
  insightTitle?: string;
  insightBody?: string;
  insightIcon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export const StatCard: React.FC<StatCardProps> = ({
  label,
  amount,
  badge,
  insightTitle,
  insightBody,
  insightIcon,
  style,
}) => {
  const ts = useThemeStyles();

  return (
    <LinearGradient
      colors={ts.isDark ? Gradients.dark : Gradients.light}
      locations={GRADIENT_LOCATIONS}
      start={GRADIENT_START}
      end={GRADIENT_END}
      style={[styles.statCard, style]}
    >
      <View
        pointerEvents="none"
        importantForAccessibility="no-hide-descendants"
        style={[styles.statGlow, { backgroundColor: ts.raw.primaryContainer }]}
      />
      <View style={styles.statHeader}>
        <Text style={[Typography.labelMd, styles.statLabel]} numberOfLines={1}>
          {label}
        </Text>
        {badge ? (
          <View style={styles.statBadge}>
            <Text style={[Typography.micro, styles.statBadgeText]} numberOfLines={1}>
              {badge}
            </Text>
          </View>
        ) : null}
      </View>
      <Text
        style={[Typography.displayLg, styles.statAmount]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
      >
        {amount}
      </Text>
      {insightTitle ? (
        <View style={styles.statInsight}>
          <View style={styles.statInsightIcon}>
            {insightIcon ?? <Sparkles size={18} color={Colors.white} />}
          </View>
          <View style={styles.statInsightText}>
            <Text style={[Typography.labelMd, styles.statInsightTitle]}>{insightTitle}</Text>
            {insightBody ? (
              <Text style={[Typography.labelMd, styles.statInsightBody]}>{insightBody}</Text>
            ) : null}
          </View>
        </View>
      ) : null}
    </LinearGradient>
  );
};

export interface TextCardProps {
  title: string;
  meta: string;
  body: React.ReactNode;
  icon?: React.ReactNode;
  question?: string;
  affirmLabel?: string;
  dismissLabel?: string;
  affirmIcon?: React.ReactNode;
  onAffirm?: () => void;
  onDismiss?: () => void;
  style?: StyleProp<ViewStyle>;
}

export const TextCard: React.FC<TextCardProps> = ({
  title,
  meta,
  body,
  icon,
  question,
  affirmLabel = 'Yes',
  dismissLabel = 'Dismiss',
  affirmIcon,
  onAffirm,
  onDismiss,
  style,
}) => {
  const ts = useThemeStyles();
  const hasFooter = Boolean(question || onAffirm || onDismiss);

  return (
    <View
      style={[
        styles.textCard,
        { backgroundColor: ts.raw.surface, borderColor: ts.raw.outline },
        ts.isDark ? null : styles.cardShadow,
        style,
      ]}
    >
      <View style={styles.textHeader}>
        <View style={[styles.textIcon, { backgroundColor: ts.raw.purple100 }]}>
          {icon ?? <Info size={16} color={ts.raw.primary} />}
        </View>
        <View style={styles.textHeaderText}>
          <Text
            accessibilityRole="header"
            style={[Typography.bodyBold, { color: ts.raw.onSurface }]}
            numberOfLines={1}
          >
            {title}
          </Text>
          <Text style={[Typography.micro, { color: ts.raw.onSurfaceVariant }]} numberOfLines={1}>
            {meta}
          </Text>
        </View>
      </View>
      <View style={styles.textBody}>
        {typeof body === 'string' ? (
          <Text style={[Typography.bodyRegular, { color: ts.raw.onSurface }]}>{body}</Text>
        ) : (
          body
        )}
      </View>
      {hasFooter ? (
        <View style={[styles.textFooter, { borderTopColor: ts.raw.outline }]}>
          {question ? (
            <Text
              style={[Typography.labelMd, styles.textQuestion, { color: ts.raw.onSurfaceVariant }]}
            >
              {question}
            </Text>
          ) : null}
          <View style={styles.textActions}>
            {onAffirm ? (
              <CardActionChip
                label={affirmLabel}
                icon={affirmIcon ?? <ThumbsUp size={13} color={ts.raw.primary} />}
                active
                onPress={onAffirm}
              />
            ) : null}
            {onDismiss ? <CardActionChip label={dismissLabel} onPress={onDismiss} /> : null}
          </View>
        </View>
      ) : null}
    </View>
  );
};

function CardActionChip({
  label,
  icon,
  active = false,
  onPress,
}: {
  label: string;
  icon?: React.ReactNode;
  active?: boolean;
  onPress: () => void;
}) {
  const ts = useThemeStyles();
  const [pressed, setPressed] = useState(false);

  return (
    <Pressable
      onPress={() => {
        triggerHaptic();
        onPress();
      }}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={CHIP_HIT_SLOP}
      style={[styles.chip, { backgroundColor: pressed ? ts.raw.purple100 : ts.bg.low }]}
    >
      {icon ? <View style={styles.chipIcon}>{icon}</View> : null}
      <Text
        style={[
          Typography.labelMd,
          active ? styles.chipLabelActive : null,
          { color: active ? ts.raw.primary : ts.raw.onSurfaceVariant },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export interface PickerSheetItem {
  id: string;
  name: string;
  description?: string;
  meta?: string;
  tint: string;
  iconColor: string;
  // Rendered with the item icon color so tinted chips stay data-driven.
  icon: (color: string) => React.ReactNode;
}

export interface PickerSheetProps {
  title: string;
  items: PickerSheetItem[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onClose: () => void;
  emptyLabel?: string;
  style?: StyleProp<ViewStyle>;
}

export const PickerSheet: React.FC<PickerSheetProps> = ({
  title,
  items,
  selectedId,
  onSelect,
  onClose,
  emptyLabel,
  style,
}) => {
  const ts = useThemeStyles();

  return (
    <View
      style={[
        styles.pickerSheet,
        { backgroundColor: ts.raw.surface, borderColor: ts.raw.outline },
        ts.isDark ? styles.pickerGlow : styles.cardShadowLg,
        style,
      ]}
    >
      <View
        style={[styles.pickerHandle, { backgroundColor: ts.raw.onSurfaceVariant + '66' }]}
        accessible={false}
        importantForAccessibility="no-hide-descendants"
      />
      <View style={styles.pickerHeader}>
        <Text
          accessibilityRole="header"
          style={[Typography.headlineMd, { color: ts.raw.onSurface }]}
          numberOfLines={1}
        >
          {title}
        </Text>
        <Pressable
          onPress={() => {
            triggerHaptic();
            onClose();
          }}
          accessibilityRole="button"
          accessibilityLabel={`Close ${title}`}
          hitSlop={CLOSE_HIT_SLOP}
          style={({ pressed }) => [
            styles.pickerClose,
            { backgroundColor: pressed ? ts.bg.elevated : ts.bg.low },
          ]}
        >
          <X size={14} color={ts.raw.onSurfaceVariant} strokeWidth={2} />
        </Pressable>
      </View>
      {items.length === 0 ? (
        emptyLabel ? (
          <Text style={[Typography.labelMd, { color: ts.raw.onSurfaceVariant }]}>
            {emptyLabel}
          </Text>
        ) : null
      ) : (
        <View style={styles.pickerList}>
          {items.map((item) => {
            const selected = item.id === selectedId;
            return (
              <PickerRow
                key={item.id}
                item={item}
                selected={selected}
                onSelect={onSelect}
              />
            );
          })}
        </View>
      )}
    </View>
  );
};

function PickerRow({
  item,
  selected,
  onSelect,
}: {
  item: PickerSheetItem;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const ts = useThemeStyles();
  const [pressed, setPressed] = useState(false);

  const background = selected
    ? ts.raw.purple100
    : pressed
      ? ts.bg.elevated
      : ts.bg.low;

  return (
    <Pressable
      onPress={() => {
        triggerHaptic();
        onSelect(item.id);
      }}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      accessibilityRole="radio"
      accessibilityLabel={item.name}
      accessibilityState={{ selected }}
      style={[
        styles.pickerRow,
        {
          backgroundColor: background,
          borderColor: selected ? ts.raw.primary + '33' : 'transparent',
        },
      ]}
    >
      <View style={styles.pickerRowLeft}>
        <View style={[styles.pickerItemIcon, { backgroundColor: item.tint }]}>
          {item.icon(item.iconColor)}
        </View>
        <View style={styles.pickerItemText}>
          <Text style={[Typography.labelBold, { color: ts.raw.onSurface }]} numberOfLines={1}>
            {item.name}
          </Text>
          {item.description ? (
            <Text
              style={[Typography.micro, { color: ts.raw.onSurfaceVariant }]}
              numberOfLines={1}
            >
              {item.description}
            </Text>
          ) : null}
        </View>
      </View>
      {selected ? (
        <Check size={20} color={ts.raw.primary} strokeWidth={2.5} />
      ) : item.meta ? (
        <Text style={[Typography.labelMd, styles.pickerMeta, { color: ts.raw.onSurfaceVariant }]}>
          {item.meta}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: Radii.lg,
    borderWidth: 1,
    padding: Spacing.s5,
  },
  cardShadow: {
    shadowColor: LightTheme.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 3,
  },
  cardShadowLg: {
    shadowColor: LightTheme.primary,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.22,
    shadowRadius: 32,
    elevation: 8,
  },
  pickerGlow: {
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 24,
    elevation: 0,
  },

  statCard: {
    borderRadius: Radii.xl,
    padding: Spacing.s5,
    overflow: 'hidden',
  },
  statGlow: {
    position: 'absolute',
    top: -48,
    right: -48,
    width: GLOW_SIZE,
    height: GLOW_SIZE,
    borderRadius: GLOW_SIZE / 2,
    opacity: 0.3,
  },
  statHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.s2,
    gap: Spacing.s2,
  },
  statLabel: {
    // HTML line 57 uses text-[12px] font-medium: caption size with the design
    // system's medium weight, which has no combined token, so override the family.
    fontFamily: 'Manrope_500Medium',
    color: 'rgba(255,255,255,0.7)',
    flexShrink: 1,
  },
  statBadge: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: Spacing.s2,
    paddingVertical: 2,
    borderRadius: Radii.full,
  },
  statBadgeText: {
    // HTML line 58 uses font-semibold; micro is 11/500, so apply the 600 family.
    fontFamily: 'Manrope_600SemiBold',
    color: Colors.white,
  },
  statAmount: {
    color: Colors.white,
    marginBottom: Spacing.s2,
    letterSpacing: -0.5,
  },
  statInsight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s2,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderRadius: Radii.md,
    padding: Spacing.s3,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  statInsightIcon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  statInsightText: {
    flex: 1,
    minWidth: 0,
  },
  statInsightTitle: {
    color: Colors.white,
    fontFamily: 'Manrope_700Bold',
  },
  statInsightBody: {
    color: 'rgba(255,255,255,0.8)',
  },

  textCard: {
    borderRadius: Radii.lg,
    padding: Spacing.s4,
    borderWidth: 1,
  },
  textHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s2,
    marginBottom: Spacing.s2,
  },
  textIcon: {
    width: 32,
    height: 32,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textHeaderText: {
    flex: 1,
    minWidth: 0,
  },
  textBody: {
    marginBottom: Spacing.s3,
  },
  textFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Spacing.s2,
    borderTopWidth: 1,
    gap: Spacing.s2,
  },
  textQuestion: {
    flexShrink: 1,
  },
  textActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s2,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radii.full,
    paddingHorizontal: Spacing.s2,
    paddingVertical: 4,
    gap: Spacing.s1,
  },
  chipIcon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipLabelActive: {
    fontFamily: 'Manrope_600SemiBold',
  },

  pickerSheet: {
    borderTopLeftRadius: Radii.xl,
    borderTopRightRadius: Radii.xl,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    padding: Spacing.s5,
    paddingBottom: Spacing.s6,
  },
  pickerHandle: {
    width: 40,
    height: 4,
    borderRadius: Radii.full,
    alignSelf: 'center',
    marginBottom: Spacing.s3,
  },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.s3,
    gap: Spacing.s2,
  },
  pickerClose: {
    width: 28,
    height: 28,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerList: {
    gap: Spacing.s2,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.s2,
    borderRadius: Radii.md,
    borderWidth: 1,
    gap: Spacing.s2,
  },
  pickerRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s2,
    flex: 1,
    minWidth: 0,
  },
  pickerItemIcon: {
    width: 32,
    height: 32,
    borderRadius: Radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerItemText: {
    flex: 1,
    minWidth: 0,
  },
  pickerMeta: {
    fontFamily: 'Manrope_500Medium',
    flexShrink: 0,
  },
});

cssInterop(LuminousCard, {
  className: 'style',
});
