import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, { useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, Check, FolderOpen, Info, Pencil, Plus, ShieldCheck, X } from 'lucide-react-native';

import { LuminousCard } from '../../components/ui/LuminousCard';
import { PeachButton } from '../../components/ui/PeachButton';
import { ScalePressable } from '../../components/ui/ScalePressable';
import { Skeleton } from '../../components/ui/Skeleton';
import { useToast } from '../../components/ui/ToastProvider';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import { useSettings } from '../../components/ui/SettingsProvider';
import { CategoryGlyph, CATEGORY_ICON_PICKER } from '../../components/capture/CategoryGlyph';
import { Radii, Spacing, Typography } from '../../constants/tokens';
import {
  CATEGORY_COLOR_PALETTE,
  CATEGORY_DELETION_SUPPORT,
  DEFAULT_CATEGORY_ICON,
  categoryService,
} from '../../services/DataServices';
import type { CategoryMutationResult, CategoryRecord } from '../../services/DataServices';
import { databaseService } from '../../services/DatabaseService';
import { formatCurrency, resolveDisplayCurrency } from '../../utils/currency';

// S-16 Manage Categories. Rebuilt as the sole category create/edit owner
// (FR-16.1-FR-16.4): safe-area header, category list with a Default badge, an
// optional monthly limit and Edit, and one shared inline editor used for both add
// and edit. Reads and writes go through the typed category contract, never screen
// SQL. Deletion stays unsupported and is stated from the contract constant.

const MAX_CONTENT_WIDTH = 640;
// Card content is the 44px icon chip; the design card is p-3 (12) around it, so
// the row does not force the taller 56px box that pushed cards past the pair.
const ROW_MIN_HEIGHT = 44;
const ICON_CHIP = 44;
// B4-4: the mode icon in the sheet header is decoration, the close control is a
// control, so they no longer share one size. The close is a 44pt target on its own
// and needs no slop to reach it.
const MODE_CHIP = 32;
const CLOSE_SIZE = 44;
const SHEET_MAX_HEIGHT = 760;

// B4-4 preset starters. Every icon comes from CATEGORY_ICON_PICKER and every colour
// from CATEGORY_COLOR_PALETTE, so a preset can only offer values the pickers below it
// can also offer. A preset whose name already exists is filtered out at render time,
// so tapping one can never create a duplicate.
interface CategoryPreset {
  name: string;
  iconName: string;
  color: string;
}
const CATEGORY_PRESETS: CategoryPreset[] = [
  { name: 'Coffee', iconName: 'coffee', color: '#FFAB91' },
  { name: 'Gym', iconName: 'dumbbell', color: '#60A5FA' },
  { name: 'Entertainment', iconName: 'film', color: '#A78BFA' },
  { name: 'Gifts', iconName: 'gift', color: '#F472B6' },
  { name: 'Pet Care', iconName: 'paw-print', color: '#34D399' },
];

// The footer line is derived from the contract flag rather than a fixed sentence, so
// if deletion support ever ships the copy follows the capability instead of claiming
// the opposite. Today the flag is false, and the wording states that as a benefit.
const DELETION_POLICY_NOTE = CATEGORY_DELETION_SUPPORT.supported
  ? 'You can delete a category whenever you want. Past reports keep their label until you do.'
  : 'Categories are permanent, so every past report keeps its label. Rename or restyle any time.';

// The category color is a single stored value; the tinted chip derives its
// background from that value so no pastel literal is inlined.
function tintBackground(color: string): string {
  return `${color}1F`;
}

function resultMessage(result: Exclude<CategoryMutationResult, { status: 'saved' }>): string {
  switch (result.status) {
    case 'duplicate':
      return 'A category with this name already exists.';
    case 'not_found':
      return 'This category no longer exists.';
    default:
      return 'Category name is required.';
  }
}

interface EditorState {
  mode: 'add' | 'edit';
  id: string | null;
  name: string;
  color: string;
  iconName: string;
  isDefault: boolean;
  // Draft text, not a number, so an empty field stays empty rather than becoming 0.
  limit: string;
}

// Brief skeleton count for the category list. One Default-badged card plus two
// plain cards mirrors the real geometry so the loaded list arrives without shift.
const SKELETON_CATEGORY_COUNT = 3;

// Loading placeholder. Mirrors the loaded banner, count label, category cards,
// Add button, and policy line using the real content/gap styles so content lands
// with no layout shift. Decorative blocks stay hidden from assistive tech; the
// container exposes a single busy label, matching the Home/notifications convention.
function CategoriesSkeleton() {
  const ts = useThemeStyles();
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Loading categories"
      accessibilityState={{ busy: true }}
      style={{ flex: 1 }}
    >
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <LuminousCard
          variant="low"
          style={[
            styles.banner,
            {
              backgroundColor: ts.isDark ? ts.raw.surface : ts.bg.primary5,
              borderColor: ts.raw.primary + '33',
            },
          ]}
        >
          <Skeleton width={32} height={32} />
          <View style={[styles.bannerText, styles.skeletonStack]}>
            <Skeleton width="45%" height={12} />
            <Skeleton width="85%" height={10} />
          </View>
        </LuminousCard>

        <Skeleton width={140} height={10} style={styles.countLabel} />

        <View style={styles.list}>
          {Array.from({ length: SKELETON_CATEGORY_COUNT }).map((_, index) => (
            <LuminousCard
              key={index}
              variant="low"
              style={[styles.card, { backgroundColor: ts.raw.surface, borderColor: ts.raw.outline }]}
            >
              <View style={styles.cardRow}>
                <View style={styles.cardLeft}>
                  <Skeleton width={ICON_CHIP} height={ICON_CHIP} borderRadius={Radii.md} />
                  <View style={styles.cardText}>
                    <View style={styles.nameRow}>
                      <Skeleton width={index === 0 ? 120 : 90} height={14} />
                      {index === 0 ? <Skeleton width={52} height={16} borderRadius={Radii.full} /> : null}
                    </View>
                  </View>
                </View>
                <Skeleton width={64} height={32} borderRadius={Radii.sm} />
              </View>
            </LuminousCard>
          ))}
        </View>

        <Skeleton width="100%" height={50} borderRadius={Radii.md} />

        <View style={[styles.policyBox, { backgroundColor: ts.bg.low, borderColor: ts.raw.outline }]}>
          <Skeleton width={13} height={13} />
          <Skeleton width="70%" height={10} />
        </View>
      </ScrollView>
    </View>
  );
}

export default function ManageCategoriesScreen() {
  const router = useRouter();
  const ts = useThemeStyles();
  const { showToast } = useToast();
  const { settings, getCurrencySymbol } = useSettings();
  const { height } = useWindowDimensions();
  const reduceMotion = useReduceMotion();
  // Surface 7 keyboard avoidance. Replaces KeyboardAvoidingView with the same padding
  // math, but measured and applied on the UI thread so the category sheet tracks the
  // keyboard without waiting on a JS bridge frame. Applies on both platforms: per the
  // Reanimated docs, while useAnimatedKeyboard is mounted it disables Android's default
  // window resize for the whole app, so Android gets no system resize and this padding
  // is the only keyboard handling. With the keyboard closed the height is 0, so the
  // resting layout is unchanged.
  const keyboard = useAnimatedKeyboard();
  const keyboardPaddingStyle = useAnimatedStyle(() => ({
    paddingBottom: keyboard.height.get(),
  }));

  const [categories, setCategories] = useState<CategoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // One settings read covers every card, so a list of twenty categories costs the
  // same as a list of two. Wave 0 D3 reads the entire map in a single pass.
  const [limits, setLimits] = useState<Record<string, number>>({});

  const appCurrency = resolveDisplayCurrency(settings.currency);

  const loadLimits = useCallback(async () => {
    try {
      setLimits(await databaseService.getAllCategoryLimits());
    } catch {
      // A read failure means no cap is shown, which is honest: the list still loads.
      setLimits({});
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [rows] = await Promise.all([categoryService.list(), loadLimits()]);
      setCategories(rows);
    } catch {
      setLoadError('Categories could not load. Your data stays on this device.');
    } finally {
      setLoading(false);
    }
  }, [loadLimits]);

  // Pull-to-refresh variant. Re-reads the same typed contract but never flips the
  // loading flag, so the loaded list does not flash back into the skeleton state.
  // A failed pull keeps the current list on screen and surfaces a toast instead.
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const [rows] = await Promise.all([categoryService.list(), loadLimits()]);
      setCategories(rows);
    } catch {
      showToast('Categories could not refresh', 'error');
    } finally {
      setRefreshing(false);
    }
  }, [loadLimits, showToast]);

  useEffect(() => {
    // Deferred so the initial load does not setState synchronously inside the
    // effect body; the cleanup cancels a pending load on unmount.
    const timer = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const openAdd = useCallback(() => {
    setFormError(null);
    setEditor({
      mode: 'add',
      id: null,
      name: '',
      color: CATEGORY_COLOR_PALETTE[0],
      iconName: DEFAULT_CATEGORY_ICON,
      isDefault: false,
      limit: '',
    });
  }, []);

  const openEdit = useCallback((category: CategoryRecord) => {
    setFormError(null);
    const stored = limits[category.id];
    setEditor({
      mode: 'edit',
      id: category.id,
      name: category.title,
      color: category.color,
      iconName: category.iconName,
      isDefault: category.isDefault,
      limit: typeof stored === 'number' && stored > 0 ? String(stored) : '',
    });
  }, [limits]);

  const closeEditor = useCallback(() => {
    setEditor(null);
    setFormError(null);
  }, []);

  const save = useCallback(async () => {
    if (!editor) return;
    const title = editor.name.trim();
    if (!title) {
      setFormError('Category name is required.');
      return;
    }
    // The limit is validated before anything is written, so a bad amount cannot
    // leave a half saved category behind.
    const limitText = editor.limit.trim();
    const limitValue = limitText === '' ? null : Number(limitText);
    if (limitValue !== null && (!Number.isFinite(limitValue) || limitValue < 0)) {
      setFormError('Enter a monthly limit of zero or more, or leave it empty.');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      let result: CategoryMutationResult;
      if (editor.mode === 'edit') {
        if (!editor.id) {
          setFormError('This category no longer exists.');
          return;
        }
        result = await categoryService.update({
          id: editor.id,
          title,
          iconName: editor.iconName,
          color: editor.color,
        });
      } else {
        result = await categoryService.create({ title, iconName: editor.iconName, color: editor.color });
      }

      if (result.status !== 'saved') {
        setFormError(resultMessage(result));
        return;
      }

      // The category is saved at this point, so a limit failure is reported on its
      // own and never re-runs the create, which would duplicate the category.
      try {
        if (limitValue === null) await databaseService.clearCategoryLimit(result.category.id);
        else await databaseService.setCategoryLimit(result.category.id, limitValue);
        await loadLimits();
      } catch {
        setCategories((previous) => (
          editor.mode === 'add'
            ? [...previous, result.category]
            : previous.map((category) => (category.id === result.category.id ? result.category : category))
        ));
        closeEditor();
        showToast('Category saved, but the monthly limit was not saved.', 'error');
        return;
      }

      setCategories((previous) => (
        editor.mode === 'add'
          ? [...previous, result.category]
          : previous.map((category) => (category.id === result.category.id ? result.category : category))
      ));
      closeEditor();
      showToast(editor.mode === 'add' ? `Added "${title}"` : `Updated "${title}"`, 'success');
    } catch {
      setFormError('Could not save the category. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [editor, closeEditor, loadLimits, showToast]);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/settings');
  }, [router]);

  const editing = editor?.mode === 'edit';
  const sheetMaxHeight = Math.min(height * 0.92, SHEET_MAX_HEIGHT);

  // B4-4: a preset is only offered when its name is free, so tapping one can never
  // create a category the contract would reject as a duplicate.
  const presetOptions = useMemo(() => {
    const taken = new Set(categories.map((category) => category.title.trim().toLowerCase()));
    return CATEGORY_PRESETS.filter((preset) => !taken.has(preset.name.toLowerCase()));
  }, [categories]);

  return (
    <SafeAreaView style={{ backgroundColor: ts.bg.screen, flex: 1 }} edges={['top']}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <ScalePressable
            onPress={goBack}
            accessibilityRole="button"
            accessibilityLabel="Back to Settings"
            hitSlop={4}
            style={[styles.backCircle, { backgroundColor: ts.bg.card, borderColor: ts.raw.outline }]}
          >
            <ArrowLeft size={18} color={ts.raw.onSurface} />
          </ScalePressable>
          <View style={styles.headerText}>
            <Text accessibilityRole="header" style={[Typography.headlineMd, { color: ts.raw.onSurface }]}>
              Categories
            </Text>
            <Text style={[Typography.micro, { color: ts.raw.onSurfaceVariant }]}>Personal budget buckets</Text>
          </View>
        </View>
        <PeachButton
          title="Add"
          onPress={openAdd}
          variant="primary"
          size="sm"
          icon={<Plus size={16} color="#FFFFFF" strokeWidth={2.5} />}
        />
      </View>

      {loading ? (
        <CategoriesSkeleton />
      ) : loadError ? (
        <View style={styles.centerBox}>
          <LuminousCard variant="low" style={styles.messageCard}>
            <Text style={[Typography.bodyBold, { color: ts.raw.onSurface }]}>Categories could not load</Text>
            <Text style={[Typography.labelMd, { color: ts.raw.onSurfaceVariant, marginTop: Spacing.s1 }]}>
              Your data stays on this device. Try again to read your categories.
            </Text>
            <PeachButton
              title="Retry"
              onPress={() => void load()}
              variant="primary"
              size="sm"
              style={{ marginTop: Spacing.s3 }}
            />
          </LuminousCard>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={ts.raw.primary} colors={[ts.raw.primary]} />
          }
        >
          <LuminousCard variant="low" style={[styles.banner, { backgroundColor: ts.isDark ? ts.raw.surface : ts.bg.primary5, borderColor: ts.raw.primary + '33' }]}>
            <View style={[styles.bannerChip, { backgroundColor: ts.raw.purple100 }]}>
              <ShieldCheck size={16} color={ts.raw.primary} />
            </View>
            <View style={styles.bannerText}>
              <Text style={[Typography.captionBold, { color: ts.isDark ? ts.raw.primary : ts.raw.onSurface }]}>
                Your categories keep your reports readable
              </Text>
              <Text style={[Typography.micro, { color: ts.raw.onSurfaceVariant, lineHeight: 17 }]}>
                Every transaction points at a category that stays on this device, so a past report always has a label. Rename or restyle any of them whenever you like.
              </Text>
            </View>
          </LuminousCard>

          <Text style={[Typography.captionBold, styles.countLabel, { color: ts.raw.onSurfaceVariant }]}>
            {`YOUR CATEGORIES (${categories.length})`}
          </Text>

          {categories.length === 0 ? (
            <View style={styles.emptyState}>
              <View style={[styles.emptyChip, { backgroundColor: ts.raw.purple100 }]}>
                <FolderOpen size={30} color={ts.raw.primary} />
              </View>
              <Text style={[Typography.bodyBold, { color: ts.raw.onSurface }]}>No categories yet</Text>
              <Text style={[Typography.labelMd, styles.emptyBody, { color: ts.raw.onSurfaceVariant }]}>
                Create categories to structure your expense analysis and auto-capture heuristics.
              </Text>
              <PeachButton title="Create First Category" onPress={openAdd} variant="primary" size="sm" />
            </View>
          ) : (
            <View style={styles.list}>
              {categories.map((category) => {
                const categoryLimit = limits[category.id];
                return (
                <LuminousCard
                  key={category.id}
                  variant="low"
                  style={[styles.card, { backgroundColor: ts.raw.surface, borderColor: ts.raw.outline }]}
                >
                  <View style={styles.cardRow}>
                    <View style={styles.cardLeft}>
                      <View style={[styles.iconChip, { backgroundColor: tintBackground(category.color) }]}>
                        <CategoryGlyph iconName={category.iconName} size={20} color={category.color} />
                      </View>
                      <View style={styles.cardText}>
                        <View style={styles.nameRow}>
                          <Text numberOfLines={1} style={[Typography.labelBold, styles.name, { color: ts.raw.onSurface }]}>
                            {category.title}
                          </Text>
                          {category.isDefault ? (
                            <View style={[styles.defaultBadge, { backgroundColor: ts.raw.purple100 }]}>
                              <Text style={[Typography.micro, { color: ts.raw.primary }]}>Default</Text>
                            </View>
                          ) : null}
                        </View>
                        {typeof categoryLimit === 'number' && categoryLimit > 0 ? (
                          <Text numberOfLines={1} style={[Typography.micro, { color: ts.raw.onSurfaceVariant }]}>
                            Monthly limit {formatCurrency(categoryLimit, appCurrency)}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                    <PeachButton
                      title="Edit"
                      onPress={() => openEdit(category)}
                      variant="secondary"
                      size="xs"
                      accessibilityLabel={`Edit ${category.title}`}
                      icon={<Pencil size={12} color={ts.raw.primary} />}
                    />
                  </View>
                </LuminousCard>
                );
              })}
            </View>
          )}

          <PeachButton
            title="Add New Category"
            onPress={openAdd}
            variant="primary"
            size="lg"
            fullWidth
            icon={<Plus size={18} color="#FFFFFF" strokeWidth={2.5} />}
          />

          <View style={[styles.policyBox, { backgroundColor: ts.bg.low, borderColor: ts.raw.outline }]}>
            <Info size={13} color={ts.raw.onSurfaceVariant} />
            <Text style={[Typography.micro, styles.policyText, { color: ts.raw.onSurfaceVariant }]}>
              {DELETION_POLICY_NOTE}
            </Text>
          </View>
        </ScrollView>
      )}

      <Modal
        visible={editor !== null}
        transparent
        animationType={reduceMotion ? 'none' : 'slide'}
        onRequestClose={closeEditor}
      >
        <Animated.View style={[styles.modalRoot, keyboardPaddingStyle]}>
          <Pressable
            onPress={closeEditor}
            accessibilityRole="button"
            accessibilityLabel="Dismiss category editor"
            style={styles.backdrop}
          />
          <View
            accessibilityViewIsModal
            style={[
              styles.sheet,
              {
                backgroundColor: ts.raw.surface,
                borderTopColor: ts.raw.outline,
                maxHeight: sheetMaxHeight,
              },
            ]}
          >
            <View style={[styles.sheetHeader, { borderBottomColor: ts.border.subtle }]}>
              <View style={styles.sheetHeaderLeft}>
                <View style={[styles.sheetModeChip, { backgroundColor: ts.raw.purple100 }]}>
                  {editing ? (
                    <Pencil size={16} color={ts.raw.primary} />
                  ) : (
                    <Plus size={16} color={ts.raw.primary} strokeWidth={2.5} />
                  )}
                </View>
                <View style={styles.sheetHeaderText}>
                  <Text
                    accessibilityRole="header"
                    numberOfLines={1}
                    style={[Typography.bodyBold, { color: ts.raw.onSurface }]}
                  >
                    {editing && editor ? `Edit '${editor.name}'` : 'Create New Category'}
                  </Text>
                  <Text numberOfLines={2} style={[Typography.micro, { color: ts.raw.onSurfaceVariant }]}>
                    {editing
                      ? 'Updates transaction classifications across PeachSpend'
                      : 'Define a custom budget bucket for transactions'}
                  </Text>
                </View>
              </View>
              <ScalePressable
                onPress={closeEditor}
                accessibilityRole="button"
                accessibilityLabel="Close editor"
                style={[styles.closeCircle, { backgroundColor: ts.bg.low, borderColor: ts.raw.outline }]}
              >
                <X size={18} color={ts.raw.onSurfaceVariant} />
              </ScalePressable>
            </View>

            {editor ? (
              <>
                <ScrollView
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                  style={styles.sheetBody}
                  contentContainerStyle={styles.sheetBodyContent}
                >
                  <View style={[styles.previewBox, { backgroundColor: ts.bg.low, borderColor: ts.raw.outline }]}>
                    <View style={[styles.previewChip, { backgroundColor: tintBackground(editor.color) }]}>
                      <CategoryGlyph iconName={editor.iconName} size={24} color={editor.color} />
                    </View>
                    <View style={styles.previewText}>
                      <Text style={[Typography.micro, styles.previewLabel, { color: ts.raw.onSurfaceVariant }]}>
                        LIVE PREVIEW
                      </Text>
                      <Text numberOfLines={1} style={[Typography.bodyBold, { color: ts.raw.onSurface }]}>
                        {editor.name.trim() || 'Untitled Category'}
                      </Text>
                      <Text style={[Typography.micro, { color: ts.raw.primary }]}>
                        {editor.isDefault ? 'Core System Bucket' : 'Custom User Bucket'}
                      </Text>
                    </View>
                  </View>

                  {!editing && presetOptions.length > 0 ? (
                    <View>
                      <Text style={[Typography.captionBold, styles.fieldLabel, { color: ts.raw.onSurface }]}>
                        Start from a preset
                      </Text>
                      <View style={styles.presetRow}>
                        {presetOptions.map((preset) => (
                          <ScalePressable
                            key={preset.name}
                            accessibilityRole="button"
                            accessibilityLabel={`Start a ${preset.name} category`}
                            onPress={() => {
                              setEditor((current) => (current
                                ? { ...current, name: preset.name, iconName: preset.iconName, color: preset.color }
                                : current));
                              if (formError) setFormError(null);
                            }}
                            style={[styles.presetChip, { backgroundColor: tintBackground(preset.color), borderColor: ts.raw.outline }]}
                          >
                            <CategoryGlyph iconName={preset.iconName} size={14} color={preset.color} />
                            <Text numberOfLines={1} style={[Typography.micro, { color: ts.raw.onSurface }]}>
                              {preset.name}
                            </Text>
                          </ScalePressable>
                        ))}
                      </View>
                    </View>
                  ) : null}

                  <View>
                    <Text style={[Typography.captionBold, styles.fieldLabel, { color: ts.raw.onSurface }]}>
                      Category Name
                    </Text>
                    <TextInput
                      value={editor.name}
                      onChangeText={(value) => {
                        setEditor((current) => (current ? { ...current, name: value } : current));
                        if (formError) setFormError(null);
                      }}
                      placeholder="e.g. Subscriptions, Books"
                      placeholderTextColor={ts.raw.onSurfaceVariant}
                      selectionColor={ts.raw.primary}
                      accessibilityLabel="Category name"
                      returnKeyType="done"
                      style={[
                        styles.input,
                        {
                          backgroundColor: ts.bg.low,
                          borderColor: formError ? ts.raw.danger : ts.raw.outline,
                          color: ts.raw.onSurface,
                        },
                      ]}
                    />
                    {formError ? (
                      <Text
                        accessibilityLiveRegion="polite"
                        style={[Typography.micro, styles.validation, { color: ts.raw.danger }]}
                      >
                        {formError}
                      </Text>
                    ) : null}
                  </View>

                  <View>
                    <Text style={[Typography.captionBold, styles.fieldLabel, { color: ts.raw.onSurface }]}>
                      Monthly Spending Limit
                    </Text>
                    <View style={[styles.limitWrap, { backgroundColor: ts.bg.low, borderColor: ts.raw.outline }]}>
                      <Text style={[Typography.labelBold, { color: ts.raw.onSurfaceVariant }]}>
                        {getCurrencySymbol(appCurrency)}
                      </Text>
                      <TextInput
                        value={editor.limit}
                        onChangeText={(value) => {
                          setEditor((current) => (current ? { ...current, limit: value } : current));
                          if (formError) setFormError(null);
                        }}
                        keyboardType="decimal-pad"
                        accessibilityLabel="Monthly spending limit"
                        placeholder="No limit"
                        placeholderTextColor={ts.raw.onSurfaceVariant}
                        selectionColor={ts.raw.primary}
                        style={[styles.limitInput, Typography.labelBold, { color: ts.raw.onSurface }]}
                      />
                    </View>
                    <Text style={[Typography.micro, styles.validation, { color: ts.raw.onSurfaceVariant }]}>
                      Optional. Shown on this category card. Left empty means no limit.
                    </Text>
                  </View>

                  <View>
                    <Text style={[Typography.captionBold, styles.fieldLabel, { color: ts.raw.onSurface }]}>
                      Color Tint
                    </Text>
                    <View style={styles.swatchGrid} accessibilityRole="radiogroup" accessibilityLabel="Category color">
                      {CATEGORY_COLOR_PALETTE.map((color, index) => {
                        const selected = editor.color === color;
                        return (
                          <ScalePressable
                            key={color}
                            haptic={false}
                            onPress={() => setEditor((current) => (current ? { ...current, color } : current))}
                            accessibilityRole="radio"
                            accessibilityLabel={`Color ${index + 1}`}
                            accessibilityState={{ selected }}
                            style={[
                              styles.swatch,
                              {
                                backgroundColor: color,
                                borderColor: selected ? ts.raw.primary : ts.raw.outline,
                                borderWidth: selected ? 3 : 1,
                              },
                            ]}
                          >
                            {selected ? <Check size={16} color={'#FFFFFF'} strokeWidth={3} /> : null}
                          </ScalePressable>
                        );
                      })}
                    </View>
                  </View>

                  <View>
                    <Text style={[Typography.captionBold, styles.fieldLabel, { color: ts.raw.onSurface }]}>
                      Icon
                    </Text>
                    <View style={styles.iconGrid} accessibilityRole="radiogroup" accessibilityLabel="Category icon">
                      {CATEGORY_ICON_PICKER.map((iconName) => {
                        const selected = editor.iconName === iconName;
                        return (
                          <ScalePressable
                            key={iconName}
                            haptic={false}
                            onPress={() => setEditor((current) => (current ? { ...current, iconName } : current))}
                            accessibilityRole="radio"
                            accessibilityLabel={iconName}
                            accessibilityState={{ selected }}
                            style={[
                              styles.iconCell,
                              {
                                backgroundColor: selected ? ts.raw.primary : ts.bg.low,
                                borderColor: selected ? ts.raw.primary : ts.raw.outline,
                              },
                            ]}
                          >
                            <CategoryGlyph iconName={iconName} size={18} color={selected ? '#FFFFFF' : ts.raw.onSurfaceVariant} />
                          </ScalePressable>
                        );
                      })}
                    </View>
                  </View>
                </ScrollView>

                <View style={[styles.sheetFooter, { borderTopColor: ts.border.subtle }]}>
                  <PeachButton
                    title="Cancel"
                    onPress={closeEditor}
                    variant="quiet"
                    size="lg"
                    disabled={saving}
                    style={styles.footerButton}
                  />
                  <PeachButton
                    title={editing ? 'Save Changes' : 'Create Category'}
                    onPress={() => void save()}
                    variant="primary"
                    size="lg"
                    isLoading={saving}
                    disabled={saving}
                    icon={<Check size={16} color="#FFFFFF" strokeWidth={2.5} />}
                    style={styles.footerButton}
                  />
                </View>
              </>
            ) : null}
          </View>
        </Animated.View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.s3,
    paddingHorizontal: Spacing.s5,
    paddingVertical: Spacing.s3,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s3,
    flex: 1,
    minWidth: 0,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  backCircle: {
    width: 40,
    height: 40,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  centerBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.s5,
  },
  messageCard: {
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
  },
  content: {
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: 'center',
    paddingHorizontal: Spacing.s5,
    paddingTop: Spacing.s3,
    paddingBottom: Spacing.s9,
    gap: Spacing.s4,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.s3,
    padding: Spacing.s3,
    borderRadius: Radii.md,
  },
  bannerChip: {
    width: 32,
    height: 32,
    borderRadius: Radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerText: {
    flex: 1,
    minWidth: 0,
    gap: Spacing.s1,
  },
  countLabel: {
    letterSpacing: 0.6,
    marginTop: Spacing.s1,
  },
  skeletonStack: { gap: Spacing.s1 },
  list: {
    gap: Spacing.s2,
  },
  card: {
    padding: Spacing.s3,
    borderRadius: Radii.md,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.s3,
    minHeight: ROW_MIN_HEIGHT,
  },
  cardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s3,
    flex: 1,
    minWidth: 0,
  },
  iconChip: {
    width: ICON_CHIP,
    height: ICON_CHIP,
    borderRadius: Radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardText: {
    flex: 1,
    minWidth: 0,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s2,
  },
  name: {
    flexShrink: 1,
  },
  defaultBadge: {
    paddingHorizontal: Spacing.s2,
    paddingVertical: 2,
    borderRadius: Radii.full,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: Spacing.s7,
    paddingHorizontal: Spacing.s4,
    gap: Spacing.s2,
  },
  emptyChip: {
    width: 64,
    height: 64,
    borderRadius: Radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.s2,
  },
  emptyBody: {
    textAlign: 'center',
    maxWidth: 260,
    marginBottom: Spacing.s2,
  },
  policyBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.s2,
    padding: Spacing.s3,
    borderRadius: Radii.sm,
    borderWidth: 1,
  },
  policyText: {
    textAlign: 'center',
    flexShrink: 1,
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: 'center',
    borderTopLeftRadius: Radii.xl,
    borderTopRightRadius: Radii.xl,
    borderTopWidth: 1,
    overflow: 'hidden',
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.s3,
    paddingHorizontal: Spacing.s5,
    paddingTop: Spacing.s3,
    paddingBottom: Spacing.s3,
    borderBottomWidth: 1,
  },
  sheetHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s2,
    flex: 1,
    minWidth: 0,
  },
  sheetModeChip: {
    width: MODE_CHIP,
    height: MODE_CHIP,
    borderRadius: Radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetHeaderText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  closeCircle: {
    width: CLOSE_SIZE,
    height: CLOSE_SIZE,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  sheetBody: {
    flexShrink: 1,
  },
  sheetBodyContent: {
    padding: Spacing.s5,
    gap: Spacing.s4,
  },
  previewBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s4,
    padding: Spacing.s3,
    borderRadius: Radii.md,
    borderWidth: 1,
  },
  previewChip: {
    width: 48,
    height: 48,
    borderRadius: Radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  previewLabel: {
    letterSpacing: 0.6,
  },
  fieldLabel: {
    marginBottom: Spacing.s2,
  },
  input: {
    minHeight: 44,
    borderRadius: Radii.md,
    borderWidth: 1,
    paddingHorizontal: Spacing.s4,
    ...Typography.bodyMd,
  },
  validation: {
    marginTop: Spacing.s1,
  },
  swatchGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.s2,
  },
  swatch: {
    flexBasis: '13%',
    flexGrow: 1,
    minWidth: 48,
    maxWidth: 64,
    aspectRatio: 1,
    borderRadius: Radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.s2,
  },
  iconCell: {
    flexBasis: '13%',
    flexGrow: 1,
    minWidth: 48,
    maxWidth: 64,
    aspectRatio: 1,
    borderRadius: Radii.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  presetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.s2,
  },
  presetChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s1,
    minHeight: 44,
    paddingHorizontal: Spacing.s3,
    borderRadius: Radii.full,
    borderWidth: 1,
  },
  limitWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s1,
    minHeight: 44,
    borderRadius: Radii.md,
    borderWidth: 1,
    paddingHorizontal: Spacing.s4,
  },
  limitInput: {
    flex: 1,
    minWidth: 60,
    minHeight: 44,
    paddingVertical: Spacing.s2,
  },
  sheetFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s3,
    padding: Spacing.s4,
    borderTopWidth: 1,
  },
  footerButton: {
    flex: 1,
  },
});
