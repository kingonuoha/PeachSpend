import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal as RNModal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { Image } from 'expo-image';
import { AlertCircle, AlertTriangle, ChevronRight, RotateCcw, Trash2 } from 'lucide-react-native';
import { CategoryGlyph } from '../capture/CategoryGlyph';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { format } from 'date-fns';
import { Radii, Spacing, Typography } from '../../constants/tokens';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import { ScannedReceipt } from '../../types/gemini';
import { formatCurrency, getCurrencyPrefix, resolveCurrency } from '../../utils/currency';
import { PeachButton } from '../ui/PeachButton';
import { CategoryPickerSheet, type CaptureCategory } from '../capture/CategoryPickerSheet';
import { databaseService } from '../../services/DatabaseService';

// The pair caps the sheet at 730pt and the itemized body at 460pt. Both are
// upper bounds, not device widths: the real value is min(pair cap, viewport).
const SHEET_MAX_HEIGHT = 730;
const BODY_MAX_HEIGHT = 460;
const LOW_CONFIDENCE_THRESHOLD = 0.8;
const ITEMS_EXPANDED_HEIGHT = 176;
const ITEMS_COLLAPSED_HEIGHT = 80;
// Shifted from brand-600 to brand-500 to purple-600 in the canonical pair.
const CONFIRM_GRADIENT = ['#7C3AED', '#8B5CF6', '#9333EA'] as const;

const parseEditableAmount = (value: string): number | null => {
  const parsed = Number(value.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
};

const humanizeCategory = (id: string): string =>
  id
    .replace(/[-_]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

interface VerificationSheetProps {
  isVisible: boolean;
  data: ScannedReceipt | ScannedReceipt[] | null | unknown;
  onConfirm: (data: ScannedReceipt[]) => void | Promise<void>;
  onCancel: () => void;
  /** Source context only changes the header badge; the sheet identity is shared. */
  origin?: 'scan' | 'share';
  /** Owned receipt image from the caller. The sheet never fabricates one. */
  imageUri?: string | null;
  /** Re-runs extraction. Omit to hide the affordance. */
  onRetry?: () => void;
}

export const VerificationSheet: React.FC<VerificationSheetProps> = ({
  isVisible,
  data,
  onConfirm,
  onCancel,
  origin = 'scan',
  imageUri = null,
  onRetry,
}) => {
  const ts = useThemeStyles();
  const insets = useSafeAreaInsets();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const reduceMotion = useReducedMotion();

  const [items, setItems] = useState<ScannedReceipt[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [categories, setCategories] = useState<CaptureCategory[]>([]);
  const [isCategoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [saving, setSaving] = useState(false);
  const mountedRef = useRef(true);

  const overlayOpacity = useSharedValue(0);
  const sheetTranslate = useSharedValue(windowHeight);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let resetTimer: ReturnType<typeof setTimeout> | undefined;
    if (isVisible) {
      // Deferred so the reset runs after render, keeping the effect free of
      // synchronous cascading state updates while the sheet animates in.
      resetTimer = setTimeout(() => {
        const nextItems = data ? (Array.isArray(data) ? [...data] : [data as ScannedReceipt]) : [];
        setItems(nextItems);
        setSelectedCategoryId(nextItems[0]?.category ?? '');
        setCollapsed(false);
        setConfirmClose(false);
        setSaving(false);
      }, 0);
      overlayOpacity.value = reduceMotion ? 1 : withTiming(1, { duration: 250 });
      sheetTranslate.value = reduceMotion ? 0 : withSpring(0, { damping: 20, mass: 1, stiffness: 200 });
    } else {
      overlayOpacity.value = reduceMotion ? 0 : withTiming(0, { duration: 200 });
      sheetTranslate.value = reduceMotion ? windowHeight : withTiming(windowHeight, { duration: 200, easing: Easing.in(Easing.cubic) });
    }
    return () => {
      if (resetTimer) clearTimeout(resetTimer);
    };
  }, [isVisible, data, overlayOpacity, sheetTranslate, windowHeight, reduceMotion]);

  // Category titles live in the data layer, not in the sheet. Load once per open.
  useEffect(() => {
    if (!isVisible) return;
    let active = true;
    void databaseService
      .getCategories()
      .then((rows) => {
        if (!active) return;
        setCategories(rows.map((row) => ({ id: row.id, title: row.title, icon_name: row.icon_name })));
      })
      .catch(() => {
        if (active) setCategories([]);
      });
    return () => {
      active = false;
    };
  }, [isVisible]);

  const overlayStyle = useAnimatedStyle(() => ({ opacity: overlayOpacity.value }));
  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: sheetTranslate.value }] }));

  const sheetMaxHeight = Math.min(SHEET_MAX_HEIGHT, windowHeight - insets.top - Spacing.s3);
  const bodyMaxHeight = Math.min(BODY_MAX_HEIGHT, windowHeight * 0.52);
  const sheetMaxWidth = Math.min(windowWidth, 640);

  const total = useMemo(
    () => items.reduce((sum, item) => sum + (Number.isFinite(item.amount) ? item.amount : 0), 0),
    [items],
  );

  const currency = useMemo(
    () => resolveCurrency(items[0]?.currency, items[0]?.currency),
    [items],
  );

  const confidence = useMemo(() => {
    const values = items
      .map((item) => item.confidence)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
    return values.length > 0 ? Math.min(...values) : null;
  }, [items]);

  const isLowConfidence = confidence !== null && confidence < LOW_CONFIDENCE_THRESHOLD;

  const selectedCategory = useMemo((): CaptureCategory => {
    const match = categories.find((category) => category.id === selectedCategoryId);
    if (match) return match;
    return { id: selectedCategoryId, title: selectedCategoryId ? humanizeCategory(selectedCategoryId) : '' };
  }, [categories, selectedCategoryId]);

  const merchant = items[0]?.merchant ?? '';
  const merchantError = merchant.trim().length === 0;
  const amountError = !(total > 0);
  const categoryError = selectedCategoryId.trim().length === 0;
  const canConfirm = !merchantError && !amountError && !categoryError && items.length > 0 && !saving;

  const updateItem = useCallback((index: number, patch: Partial<ScannedReceipt>) => {
    setItems((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }, []);

  const handleAmountChange = useCallback((index: number, value: string) => {
    const parsed = parseEditableAmount(value);
    if (parsed === null) return;
    setItems((current) => current.map((item, i) => {
      if (i !== index) return item;
      const units = item.units ?? 1;
      return { ...item, amount: parsed, unit_price: units > 0 ? parsed / units : parsed };
    }));
  }, []);

  const handleMerchantChange = useCallback((value: string) => {
    setItems((current) => current.map((item) => ({ ...item, merchant: value })));
  }, []);

  const handleRemoveItem = useCallback((index: number) => {
    setItems((current) => current.filter((_, i) => i !== index));
  }, []);

  const handleSelectCategory = useCallback((category: CaptureCategory) => {
    setSelectedCategoryId(category.id);
    setItems((current) => current.map((item) => ({ ...item, category: category.id })));
    setCategoryPickerOpen(false);
  }, []);

  const handleCancel = useCallback(() => {
    if (items.length > 0) setConfirmClose(true);
    else onCancel();
  }, [items.length, onCancel]);

  const confirmCloseAndReset = useCallback(() => {
    setConfirmClose(false);
    setItems([]);
    onCancel();
  }, [onCancel]);

  const handleConfirm = useCallback(async () => {
    if (!canConfirm) return;
    setSaving(true);
    try {
      await onConfirm(items);
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }, [canConfirm, items, onConfirm]);

  if (!isVisible && items.length === 0) return null;

  const originLabel = origin === 'share' ? 'Shared Image' : 'Scan Origin';
  const originBadge = `${originLabel} • ${origin === 'share' ? 'S-13' : 'S-04'}`;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={isVisible ? 'auto' : 'none'}>
      <Animated.View style={[overlayStyle, { backgroundColor: ts.bg.overlay }]} className="absolute inset-0">
        <Pressable className="flex-1" onPress={handleCancel} accessibilityLabel="Dismiss verification" />
      </Animated.View>

      <KeyboardAvoidingView
        style={StyleSheet.absoluteFill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        pointerEvents="box-none"
      >
        <View style={{ flex: 1, justifyContent: 'flex-end' }} pointerEvents="box-none">
          <Animated.View
            accessibilityViewIsModal={isVisible}
            style={[
              sheetStyle,
              {
                maxHeight: sheetMaxHeight,
                maxWidth: sheetMaxWidth,
                width: '100%',
                alignSelf: 'center',
                backgroundColor: ts.raw.surface,
                borderTopLeftRadius: Radii.xxl,
                borderTopRightRadius: Radii.xxl,
                borderTopWidth: 1,
                borderColor: ts.border.card,
              },
            ]}
          >
            {/* Header */}
            <View style={{ paddingTop: Spacing.s3, paddingHorizontal: Spacing.s5, paddingBottom: Spacing.s2, borderBottomWidth: 1, borderBottomColor: ts.border.subtle }}>
              <View style={{ width: 40, height: 6, borderRadius: Radii.full, backgroundColor: ts.raw.outline, alignSelf: 'center', marginBottom: Spacing.s3 }} />
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.s3 }}>
                <View style={{ flexShrink: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.s2, flexWrap: 'wrap' }}>
                    <Text style={[Typography.headlineMd, { color: ts.text.onSurface }]}>Verify Transaction</Text>
                    <View style={{ paddingHorizontal: Spacing.s2, paddingVertical: 2, borderRadius: Radii.full, backgroundColor: ts.bg.primary10, borderWidth: 1, borderColor: ts.border.primary20 }}>
                      <Text style={[Typography.micro, { color: ts.text.primary, textTransform: 'uppercase' }]}>{originBadge}</Text>
                    </View>
                  </View>
                  <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant, marginTop: 2 }]}>Verify parsed AI extraction before commit</Text>
                </View>
                {confidence !== null ? (
                  <View
                    accessibilityLabel={`OCR confidence ${Math.round(confidence * 100)} percent`}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.s2, paddingHorizontal: Spacing.s3, paddingVertical: Spacing.s1, borderRadius: Radii.full, backgroundColor: isLowConfidence ? ts.raw.warningContainer : ts.raw.successContainer, borderWidth: 1, borderColor: isLowConfidence ? ts.raw.warning : ts.raw.successBorder }}
                  >
                    <View style={{ width: 6, height: 6, borderRadius: Radii.full, backgroundColor: isLowConfidence ? ts.raw.warning : ts.raw.success }} />
                    <Text style={[Typography.micro, { color: isLowConfidence ? ts.raw.warningContainerText : ts.raw.successText }]}>
                      {Math.round(confidence * 100)}% {isLowConfidence ? 'Needs review' : 'High confidence'}
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>

            {/* Low-confidence banner */}
            {isLowConfidence ? (
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.s2, paddingHorizontal: Spacing.s4, paddingVertical: Spacing.s2, backgroundColor: ts.raw.conversionWarningBg, borderBottomWidth: 1, borderBottomColor: ts.raw.conversionWarningBorder }}>
                <AlertTriangle size={16} color={ts.raw.conversionWarningText} style={{ marginTop: 2 }} />
                <Text style={[Typography.micro, { color: ts.raw.conversionWarningText, flex: 1 }]}>
                  Heuristic flag: some values were parsed with low confidence. Verify the amount and merchant name manually.
                </Text>
              </View>
            ) : null}

            {/* Scrollable body */}
            <ScrollView
              style={{ flexShrink: 1, maxHeight: bodyMaxHeight }}
              contentContainerStyle={{ paddingHorizontal: Spacing.s5, paddingVertical: Spacing.s3, gap: Spacing.s3 }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {imageUri ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: Spacing.s2, borderRadius: Radii.sm, backgroundColor: ts.bg.primary5, borderWidth: 1, borderColor: ts.border.primary20 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.s3, flexShrink: 1 }}>
                    <View accessible accessibilityLabel="Receipt image thumbnail" style={{ width: 40, height: 40, borderRadius: Radii.sm, overflow: 'hidden', backgroundColor: ts.bg.low }}>
                      <Image source={{ uri: imageUri }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                    </View>
                    <View style={{ flexShrink: 1 }}>
                      <Text numberOfLines={1} style={[Typography.labelLg, { color: ts.text.onSurface }]}>Receipt image</Text>
                      <Text numberOfLines={1} style={[Typography.micro, { color: ts.text.onSurfaceVariant }]}>
                        {items.length} parsed item{items.length === 1 ? '' : 's'}
                      </Text>
                    </View>
                  </View>
                  {onRetry ? (
                    <TouchableOpacity
                      onPress={onRetry}
                      accessibilityRole="button"
                      accessibilityLabel="Retry receipt extraction"
                      hitSlop={8}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.s1, minHeight: 44, paddingHorizontal: Spacing.s2 }}
                    >
                      <RotateCcw size={14} color={ts.text.primary} />
                      <Text style={[Typography.micro, { color: ts.text.primary }]}>Retry</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              ) : null}

              {/* Total amount */}
              <View style={{ padding: Spacing.s3, borderRadius: Radii.md, backgroundColor: ts.bg.primary5, borderWidth: 1, borderColor: ts.border.primary20 }}>
                <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant, textTransform: 'uppercase', marginBottom: Spacing.s1 }]}>Total Amount</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.s2 }}>
                  <Text numberOfLines={1} adjustsFontSizeToFit style={[Typography.displayMd, { color: ts.text.onSurface, flexShrink: 1 }]}>
                    {formatCurrency(total, currency)}
                  </Text>
                  <View style={{ paddingHorizontal: Spacing.s2, paddingVertical: Spacing.s1, borderRadius: Radii.sm, backgroundColor: ts.bg.primary10 }}>
                    <Text style={[Typography.captionBold, { color: ts.text.primary }]}>{currency}</Text>
                  </View>
                </View>
                {amountError ? (
                  <Text style={[Typography.micro, { color: ts.text.error, marginTop: Spacing.s1 }]}>Amount is required and must be greater than {getCurrencyPrefix(currency)}0.00</Text>
                ) : null}
              </View>

              {/* Merchant */}
              <View style={{ padding: Spacing.s3, borderRadius: Radii.sm, backgroundColor: ts.bg.low, borderWidth: 1, borderColor: ts.border.subtle }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.s1 }}>
                  <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant, textTransform: 'uppercase' }]}>Merchant Name</Text>
                  <TouchableOpacity onPress={() => handleMerchantChange('')} accessibilityRole="button" accessibilityLabel="Clear merchant name" hitSlop={8} style={{ minHeight: 44, justifyContent: 'center' }}>
                    <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant }]}>Clear</Text>
                  </TouchableOpacity>
                </View>
                <TextInput
                  value={merchant}
                  onChangeText={handleMerchantChange}
                  placeholder="e.g. Merchant name"
                  placeholderTextColor={ts.text.onSurfaceVariant}
                  selectionColor={ts.raw.primary}
                  returnKeyType="done"
                  accessibilityLabel="Merchant name"
                  style={[Typography.labelMd, { color: ts.text.onSurface, backgroundColor: ts.raw.surface, borderWidth: 1, borderColor: merchantError ? ts.text.error : ts.border.card, borderRadius: Radii.sm, paddingHorizontal: Spacing.s3, paddingVertical: Spacing.s2, minHeight: 44 }]}
                />
                {merchantError ? (
                  <Text style={[Typography.micro, { color: ts.text.error, marginTop: Spacing.s1 }]}>Merchant name cannot be empty</Text>
                ) : null}
              </View>

              {/* Date & category */}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.s3 }}>
                <View style={{ flexGrow: 1, flexBasis: 150, padding: Spacing.s3, borderRadius: Radii.sm, backgroundColor: ts.bg.low, borderWidth: 1, borderColor: ts.border.subtle }}>
                  <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant, textTransform: 'uppercase', marginBottom: Spacing.s1 }]}>Date & Time</Text>
                  <Text numberOfLines={1} style={[Typography.labelMd, { color: ts.text.onSurface }]}>
                    {items[0]?.date ? format(new Date(items[0].date), 'MMM dd, yyyy • HH:mm') : 'Not detected'}
                  </Text>
                </View>
                <View style={{ flexGrow: 1, flexBasis: 150, padding: Spacing.s3, borderRadius: Radii.sm, backgroundColor: ts.bg.low, borderWidth: 1, borderColor: ts.border.subtle }}>
                  <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant, textTransform: 'uppercase', marginBottom: Spacing.s1 }]}>Category</Text>
                  <TouchableOpacity
                    onPress={() => setCategoryPickerOpen(true)}
                    accessibilityRole="button"
                    accessibilityLabel={`Category ${selectedCategory.title || 'not set'}. Change category`}
                    style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, paddingHorizontal: Spacing.s3, borderRadius: Radii.sm, backgroundColor: ts.bg.primary5, borderWidth: 1, borderColor: ts.border.primary20 }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.s2, flexShrink: 1, minWidth: 0 }}>
                      <CategoryGlyph iconName={selectedCategory.icon_name} size={16} color={ts.text.primary} />
                      <Text numberOfLines={1} style={[Typography.labelMd, { color: ts.text.onSurface, flexShrink: 1 }]}>
                        {selectedCategory.title || 'Select category'}
                      </Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.s1, flexShrink: 0 }}>
                      <Text style={[Typography.micro, { color: ts.text.primary }]}>Change</Text>
                      <ChevronRight size={12} color={ts.text.primary} />
                    </View>
                  </TouchableOpacity>
                  {categoryError ? (
                    <Text style={[Typography.micro, { color: ts.text.error, marginTop: Spacing.s1 }]}>Category is required</Text>
                  ) : null}
                </View>
              </View>

              {/* Itemized breakdown */}
              <View>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.s2 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.s2 }}>
                    <Text style={[Typography.captionBold, { color: ts.text.onSurface, textTransform: 'uppercase' }]}>Itemized Breakdown</Text>
                    <View style={{ paddingHorizontal: Spacing.s2, borderRadius: Radii.full, backgroundColor: ts.bg.primary10 }}>
                      <Text style={[Typography.micro, { color: ts.text.primary }]}>{items.length}</Text>
                    </View>
                  </View>
                  <TouchableOpacity onPress={() => setCollapsed((value) => !value)} accessibilityRole="button" accessibilityLabel={collapsed ? 'Expand item list' : 'Collapse item list'} hitSlop={8} style={{ minHeight: 44, justifyContent: 'center' }}>
                    <Text style={[Typography.micro, { color: ts.text.primary }]}>{collapsed ? 'Expand View' : 'Compact View'}</Text>
                  </TouchableOpacity>
                </View>
                <ScrollView
                  nestedScrollEnabled
                  style={{ maxHeight: collapsed ? ITEMS_COLLAPSED_HEIGHT : ITEMS_EXPANDED_HEIGHT }}
                  contentContainerStyle={{ gap: Spacing.s2 }}
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                >
                  {items.length === 0 ? (
                    <View style={{ paddingVertical: Spacing.s4, borderRadius: Radii.sm, backgroundColor: ts.bg.primary5 }}>
                      <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant, textAlign: 'center' }]}>
                        No itemized items detected. Total will be logged as a single entry.
                      </Text>
                    </View>
                  ) : (
                    items.map((item, index) => (
                      <LineItemRow
                        key={index}
                        index={index}
                        item={item}
                        currency={currency}
                        onNameChange={(value) => updateItem(index, { note: value })}
                        onAmountChange={(value) => handleAmountChange(index, value)}
                        onRemove={() => handleRemoveItem(index)}
                      />
                    ))
                  )}
                </ScrollView>
              </View>
            </ScrollView>

            {/* Actions */}
            <View style={{ padding: Spacing.s4, paddingBottom: Math.max(Spacing.s4, insets.bottom), borderTopWidth: 1, borderTopColor: ts.border.subtle, gap: Spacing.s2 }}>
              <PeachButton
                title={saving ? 'Checking Ledger...' : `Confirm & Save (${formatCurrency(total, currency)})`}
                onPress={handleConfirm}
                variant={canConfirm ? 'primary' : 'disabled'}
                disabled={!canConfirm}
                isLoading={saving}
                size="xl"
                fullWidth
                radius={Radii.sm}
                gradientColors={CONFIRM_GRADIENT}
              />
              <TouchableOpacity onPress={handleCancel} accessibilityRole="button" accessibilityLabel="Cancel and discard extraction" style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={[Typography.labelMd, { color: ts.text.onSurfaceVariant }]}>Cancel & Discard Extraction</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        </View>
      </KeyboardAvoidingView>

      <CategoryPickerSheet
        visible={isCategoryPickerOpen}
        categories={categories}
        selectedId={selectedCategoryId}
        flowType="expense"
        originLabel={merchant.trim() || undefined}
        originAmount={total > 0 ? formatCurrency(total, currency) : undefined}
        onSelect={handleSelectCategory}
        onClose={() => setCategoryPickerOpen(false)}
      />

      <RNModal visible={confirmClose} transparent animationType="fade" onRequestClose={() => setConfirmClose(false)}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.s7, backgroundColor: ts.bg.overlay }}>
          <View style={{ width: '100%', alignItems: 'center', padding: Spacing.s6, borderRadius: Radii.xl, backgroundColor: ts.raw.surface, borderWidth: 1, borderColor: ts.border.card }}>
            <View style={{ width: 64, height: 64, borderRadius: Radii.xl, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.s4, backgroundColor: ts.bg.primary10 }}>
              <AlertCircle size={32} color={ts.raw.primary} />
            </View>
            <Text style={[Typography.headlineSm, { color: ts.text.onSurface, textAlign: 'center', marginBottom: Spacing.s2 }]}>Unsaved changes</Text>
            <Text style={[Typography.bodyMd, { color: ts.text.onSurfaceVariant, textAlign: 'center', marginBottom: Spacing.s5 }]}>
              The parsed receipt has not been saved yet. Are you sure you want to leave?
            </Text>
            <PeachButton title="Leave" onPress={confirmCloseAndReset} variant="primary" size="lg" fullWidth style={{ marginBottom: Spacing.s2 }} />
            <TouchableOpacity onPress={() => setConfirmClose(false)} accessibilityRole="button" accessibilityLabel="Keep editing" style={{ minHeight: 44, justifyContent: 'center' }}>
              <Text style={[Typography.labelLg, { color: ts.text.onSurfaceVariant }]}>Keep editing</Text>
            </TouchableOpacity>
          </View>
        </View>
      </RNModal>
    </View>
  );
};

interface LineItemRowProps {
  item: ScannedReceipt;
  index: number;
  currency: string;
  onNameChange: (value: string) => void;
  onAmountChange: (value: string) => void;
  onRemove: () => void;
}

const LineItemRow = React.memo(function LineItemRow({ item, index, currency, onNameChange, onAmountChange, onRemove }: LineItemRowProps) {
  const ts = useThemeStyles();
  const [amountDraft, setAmountDraft] = React.useState(() => (Number.isFinite(item.amount) ? String(item.amount) : ''));

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: Spacing.s2, borderRadius: Radii.sm, backgroundColor: ts.bg.low, borderWidth: 1, borderColor: ts.border.subtle }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.s2, flexShrink: 1, flexGrow: 1, minWidth: 0 }}>
        <View style={{ width: 16, height: 16, borderRadius: Radii.full, alignItems: 'center', justifyContent: 'center', backgroundColor: ts.bg.primary10 }}>
          <Text style={[Typography.micro, { color: ts.text.primary }]}>{index + 1}</Text>
        </View>
        <TextInput
          value={item.note ?? ''}
          onChangeText={onNameChange}
          placeholder="Item name"
          placeholderTextColor={ts.text.onSurfaceVariant}
          selectionColor={ts.raw.primary}
          accessibilityLabel={`Item ${index + 1} name`}
          style={[Typography.labelMd, { color: ts.text.onSurface, flex: 1, minWidth: 0, padding: 0 }]}
        />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.s2, flexShrink: 0 }}>
        <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant }]}>x{item.units ?? 1}</Text>
        <TextInput
          value={amountDraft}
          onChangeText={(value) => {
            setAmountDraft(value);
            onAmountChange(value);
          }}
          onEndEditing={() => setAmountDraft(Number.isFinite(item.amount) ? String(item.amount) : '')}
          keyboardType="numeric"
          accessibilityLabel={`Item ${index + 1} amount in ${currency}`}
          style={[Typography.captionBold, { color: ts.text.onSurface, padding: 0, minWidth: 56, textAlign: 'right' }]}
        />
        <TouchableOpacity onPress={onRemove} accessibilityRole="button" accessibilityLabel={`Remove item ${index + 1}`} hitSlop={8} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
          <Trash2 size={16} color={ts.text.error} />
        </TouchableOpacity>
      </View>
    </View>
  );
});
