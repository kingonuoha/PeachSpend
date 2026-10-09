import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { ArrowDownLeft, BarChart2, Bot, Camera, Edit3, Home, MessageCircle, Plus, Scan, Share2, Trash2, User } from 'lucide-react-native';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import { PeachButton } from '../ui/PeachButton';
import { CategoryPickerGrid, type CaptureCategory } from '../capture/CategoryPickerSheet';
import { CategoryGlyph } from '../capture/CategoryGlyph';
import { EntryCurrencyPicker } from '../capture/EntryCurrencyPicker';
import { VirtualNumpad } from '../capture/VirtualNumpad';
import { AIProcessingSurface } from '../capture/AIProcessingOverlay';
import { PeachTabBar, type PeachTabAction, type PeachTabItem } from '../navigation/PeachTabBar';
import { CurrencyConversionSheet } from '../settings/CurrencyConversionModal';
import { buildCurrencyConversionPreview } from '../../services/DataServices';
import { PickerSheet, StatCard, TextCard, type PickerSheetProps, type StatCardProps, type TextCardProps } from '../ui/LuminousCard';
import { SearchFilterBar, type SearchFilterChip } from '../ui/SearchFilterBar';
import { Colors, CategoryTints, DarkTheme, LightTheme, Radii, Spacing, Typography } from '../../constants/tokens';

function pressFeedback(style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Light) {
  void Haptics.impactAsync(style);
}

// Showcase section for the canonical SH-16a pair: selection legend, the real grid,
// and the locked dark tint mapping preview. Dev-only; no production screen uses it.
export function CategoryPickerShowcase({ categories, selectedId, onSelect, onRequestCustom }: { categories: CaptureCategory[]; selectedId?: string; onSelect: (category: CaptureCategory) => void; onRequestCustom?: () => void }) {
  const ts = useThemeStyles();
  const legendRow = (dotColor: string, term: string, detail: string) => (
    <View style={categoryStyles.legendItem}>
      <View style={[categoryStyles.legendDot, { backgroundColor: dotColor }]} />
      <Text style={[Typography.micro, { color: ts.text.onSurface, fontFamily: 'Manrope_700Bold' }]}>{term}</Text>
      <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant }]}>{detail}</Text>
    </View>
  );
  return (
    <View>
      <View style={categoryStyles.annotation}>
        <Text style={[Typography.labelMd, { color: ts.text.onSurface, fontFamily: 'Manrope_700Bold', flexShrink: 1 }]}>Category Picker (SH-16a)</Text>
        <View style={[categoryStyles.gridBadge, { backgroundColor: ts.raw.purple100 }]}>
          <Text style={[Typography.micro, { color: ts.raw.primary, fontFamily: 'Manrope_600SemiBold' }]}>Grid (4-Col)</Text>
        </View>
      </View>
      <View style={[categoryStyles.legendCard, { backgroundColor: ts.raw.surface, borderColor: ts.raw.outline }]}>
        {legendRow(ts.raw.primary, 'Selected:', '2px purple ring + fill')}
        {legendRow(ts.bg.surfaceContainerHighest, 'Unselected:', 'Soft tint chip + caption')}
      </View>
      <CategoryPickerGrid categories={categories} selectedId={selectedId} onSelect={onSelect} onRequestCustom={onRequestCustom} />
      <View style={[categoryStyles.darkBox, { backgroundColor: DarkTheme.surface, borderColor: DarkTheme.outline }]}>
        <View style={categoryStyles.darkHeader}>
          <Text style={[Typography.labelMd, { color: DarkTheme.onSurface, fontFamily: 'Manrope_700Bold' }]}>Dark Mode Tint Mapping (§1 Spec)</Text>
          <Text style={[Typography.micro, { color: DarkTheme.onSurfaceVariant }]}>Dark background + bright icon</Text>
        </View>
        <View style={categoryStyles.darkGrid}>
          {categories.slice(0, 4).map((category) => {
            const tint = CategoryTints[category.id as keyof typeof CategoryTints] ?? CategoryTints.other;
            return (
              <View key={category.id} style={categoryStyles.darkCell}>
                <View style={[categoryStyles.darkChip, { backgroundColor: tint.dark[0] }]}>
                  <CategoryGlyph iconName={category.icon_name} size={18} color={tint.dark[1]} />
                </View>
                <Text numberOfLines={1} style={[Typography.micro, { color: DarkTheme.onSurfaceVariant, marginTop: Spacing.s1 }]}>{category.title}</Text>
              </View>
            );
          })}
        </View>
      </View>
    </View>
  );
}

export function CurrencyPickersShowcase() {
  const ts = useThemeStyles();
  const [quickCurrency, setQuickCurrency] = useState('USD');
  const [conversionCurrency, setConversionCurrency] = useState('EUR');
  // Dev-only fixtures. The preview is computed through the same shared contract
  // the app uses, so the showcase renders no hand-written rate, count or name.
  const preview = useMemo(
    () =>
      buildCurrencyConversionPreview(
        [
          { amount: 120, currency: 'USD' },
          { amount: 80, currency: 'EUR' },
        ],
        'USD',
        conversionCurrency,
        JSON.stringify({ USD: 1, EUR: 0.924, GBP: 0.781 }),
        ['EUR', 'GBP'],
      ),
    [conversionCurrency],
  );
  return (
    <View style={currencyStyles.stack}>
      <View style={[currencyStyles.quickCard, !ts.isDark && currencyStyles.quickCardShadow, { backgroundColor: ts.raw.surface, borderColor: ts.raw.outline }]}>
        <View style={currencyStyles.quickHeader}>
          <View style={currencyStyles.quickTitle}>
            <View style={[currencyStyles.dot, { backgroundColor: Colors.success }]} />
            <Text style={[Typography.labelBold, { color: ts.text.onSurface }]}>A. Quick-Log Currency Switcher</Text>
          </View>
          <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant }]}>Low friction</Text>
        </View>
        <Text style={[Typography.labelMd, { color: ts.text.onSurfaceVariant, marginBottom: Spacing.s3 }]}>Inline horizontal pill selector used directly within the transaction logging sheet.</Text>
        <EntryCurrencyPicker value={quickCurrency} options={['USD', 'EUR', 'GBP', 'JPY', 'NGN']} onSelect={setQuickCurrency} />
      </View>
      <View style={currencyStyles.annotation}>
        <Text style={[Typography.labelMd, { color: ts.text.onSurface, fontFamily: 'Manrope_700Bold', flexShrink: 1 }]}>B. Bulk Currency Conversion (SH-06a)</Text>
        <Text style={[Typography.micro, { color: ts.text.primary, fontFamily: 'Manrope_600SemiBold' }]}>Account-wide · rare</Text>
      </View>
      <View style={[currencyStyles.sheetPreview, { borderColor: ts.raw.outline }]}>
        <CurrencyConversionSheet
          fromCurrency="USD"
          preview={preview}
          selectedCode={conversionCurrency}
          consent
          converting={false}
          error={null}
          result={null}
          onConsentChange={() => undefined}
          onSelect={setConversionCurrency}
          onConfirm={() => undefined}
          onRetry={() => undefined}
          onClose={() => undefined}
        />
      </View>
      <Text style={[Typography.bodyMd, { color: ts.text.onSurfaceVariant }]}>Conversion options, rates and scope come from the shared conversion contract. Fixtures are dev-only.</Text>
    </View>
  );
}

// Showcase section for the canonical shared numpad. It renders the real
// VirtualNumpad with dev-only fixtures and reproduces the locked state callouts.
export function VirtualNumpadShowcase() {
  const ts = useThemeStyles();
  const [amount, setAmount] = useState('64.2');
  const pressedKey = '5';
  const handleKey = (key: string) => {
    pressFeedback();
    setAmount((prev) => {
      if (key === 'delete') return prev.length <= 1 ? '0' : prev.slice(0, -1);
      if (key === '.') return prev.includes('.') ? prev : `${prev}.`;
      if (prev === '0') return key;
      if (prev.includes('.') && prev.split('.')[1].length >= 2) return prev;
      return `${prev}${key}`;
    });
  };
  return (
    <View>
      <View style={numpadStyles.annotation}>
        <Text style={[Typography.labelMd, { color: ts.text.onSurface, fontFamily: 'Manrope_700Bold', flexShrink: 1 }]}>Virtual Numpad (S-09 / S-11)</Text>
        <View style={[numpadStyles.badge, { backgroundColor: ts.raw.purple100 }]}>
          <Text style={[Typography.micro, { color: ts.raw.primary, fontFamily: 'Manrope_600SemiBold' }]}>12-Key Pad</Text>
        </View>
      </View>
      <VirtualNumpad
        value={amount}
        currencySymbol="$"
        statusLabel={`Key '${pressedKey}' currently pressed`}
        pressedKeyPreview={pressedKey}
        pressBadgeLabel="Press"
        onKeyPress={handleKey}
      />
      <View style={numpadStyles.callouts}>
        <View style={[numpadStyles.callout, { backgroundColor: ts.raw.surface, borderColor: ts.raw.outline }]}>
          <Text style={[Typography.micro, numpadStyles.calloutTitle, { color: ts.text.onSurface }]}>Default State</Text>
          <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant }]}>White surface `#FFFFFF`, 16px radius, subtle purple shadow.</Text>
        </View>
        <View style={[numpadStyles.callout, { backgroundColor: ts.raw.purple100, borderColor: ts.raw.primary + '4D' }]}>
          <Text style={[Typography.micro, numpadStyles.calloutTitle, { color: ts.raw.primary }]}>Pressed State (§7)</Text>
          <Text style={[Typography.micro, { color: ts.text.onSurface }]}>Scale 0.94, `purple-100` background, `purple-600` accent.</Text>
        </View>
      </View>
    </View>
  );
}

// Showcase section for the canonical shared search and filter control. Renders the real
// component in both locked states. Dev-only fixtures; the component renders no fixed copy.
export function SearchFilterBarShowcase() {
  const ts = useThemeStyles();
  const [expanded, setExpanded] = useState(true);
  const [query, setQuery] = useState('Whole Foods');
  // Dev-only fixtures. Real callers pass live chips, counts and preformatted totals.
  const chips: SearchFilterChip[] = [
    { id: 'month', label: 'This Month', tone: 'applied', onRemove: () => undefined },
    { id: 'over50', label: '> $50', tone: 'active' },
    { id: 'dining', label: 'Dining' },
    { id: 'groceries', label: 'Groceries' },
  ];
  const togglePreview = () => {
    pressFeedback();
    setExpanded((value) => !value);
  };
  return (
    <View>
      <View style={searchStyles.annotation}>
        <Text style={[Typography.labelMd, { color: ts.text.onSurface, fontFamily: 'Manrope_700Bold', flexShrink: 1 }]}>Search & Filter Bar (S-03 Insights)</Text>
        <View style={searchStyles.annotationRight}>
          <View style={[searchStyles.badge, { backgroundColor: ts.raw.purple100 }]}>
            <Text style={[Typography.micro, { color: ts.raw.primary, fontFamily: 'Manrope_600SemiBold' }]}>Insights UI</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={expanded ? 'Collapse search preview' : 'Expand search preview'}
            onPress={togglePreview}
            style={[searchStyles.badge, { backgroundColor: ts.bg.low, borderColor: ts.raw.outline, borderWidth: 1 }]}
          >
            <Text style={[Typography.micro, { color: ts.raw.primary, fontFamily: 'Manrope_600SemiBold' }]}>{expanded ? 'Collapse preview' : 'Replay 180ms'}</Text>
          </Pressable>
        </View>
      </View>
      <View style={[searchStyles.card, searchStyles.cardCollapsedMb, !ts.isDark && searchStyles.cardShadowSm, { backgroundColor: ts.raw.surface, borderColor: ts.raw.outline }]}>
        <View style={searchStyles.cardHeader}>
          <Text style={[Typography.captionBold, { color: ts.text.onSurface }]}>1. Collapsed State</Text>
          <Text style={[Typography.micro, { color: ts.text.onSurfaceVariant }]}>40×40px circular trigger</Text>
        </View>
        <Text style={[Typography.labelMd, searchStyles.cardDescription, { color: ts.text.onSurfaceVariant }]}>Default state when user is reviewing high-level Insights charts and monthly cash flow.</Text>
        <View style={[searchStyles.contextBox, { backgroundColor: ts.bg.low, borderColor: ts.raw.outline }]}>
          <Text style={[Typography.headlineMd, searchStyles.contextTitle, { color: ts.text.onSurface }]}>Insights Overview</Text>
          <SearchFilterBar expanded={false} onExpandedChange={() => setExpanded(true)} query={query} onQueryChange={setQuery} onOpenFilters={() => undefined} />
        </View>
      </View>
      <View style={[searchStyles.card, !ts.isDark && searchStyles.cardShadowMd, { backgroundColor: ts.raw.surface, borderColor: ts.raw.outline }]}>
        <View style={searchStyles.cardHeader}>
          <Text style={[Typography.captionBold, { color: ts.text.onSurface }]}>2. Expanded Active State</Text>
          <Text style={[Typography.micro, { color: ts.raw.primary, fontFamily: 'Manrope_600SemiBold' }]}>Full width pill + chips</Text>
        </View>
        <Text style={[Typography.labelMd, searchStyles.cardDescription, { color: ts.text.onSurfaceVariant }]}>Expands with smooth 180ms ease, showing active search query and contextual filters.</Text>
        {expanded ? (
          <SearchFilterBar expanded query={query} onQueryChange={setQuery} onExpandedChange={setExpanded} chips={chips} resultCount={3} totalLabel="$184.20 Total" />
        ) : (
          <Text style={[Typography.labelMd, searchStyles.hint, { color: ts.text.onSurfaceVariant }]}>Press Replay 180ms to expand the search bar.</Text>
        )}
      </View>
    </View>
  );
}

// Dev-only fixture: the determinate bar mirrors the locked pair's three-quarter fill.
const PROCESSING_PROGRESS_FIXTURE = 0.75;
const processingFlows = [
  { Icon: Camera, label: 'OCR Camera Scan:', context: '"Scanning receipt…"' },
  { Icon: Share2, label: 'Share-Sheet Ingestion:', context: '"Parsing shared PDF…"' },
  { Icon: Bot, label: 'AI Query Insight:', context: '"Calculating trends…"' },
];

export function AIProcessingOverlayShowcase({ onAction }: { onAction: (action: string) => void }) {
  const ts = useThemeStyles();
  return (
    <View>
      <View style={processingStyles.annotation}>
        <Text style={[Typography.labelMd, processingStyles.annotationLabel, { color: ts.text.onSurface }]}>AI Processing Overlay</Text>
        <View style={[processingStyles.badge, { backgroundColor: ts.raw.purple100 }]}>
          <Text style={[Typography.micro, { color: ts.raw.primary, fontFamily: 'Manrope_600SemiBold' }]}>Shared Modal</Text>
        </View>
      </View>
      <AIProcessingSurface
        contextLabel="Scanning receipt…"
        title="Analyzing Line Items"
        description="Extracting merchant, date, taxes, and categorizing into Dining…"
        progress={PROCESSING_PROGRESS_FIXTURE}
        onCancel={() => onAction('Processing cancelled')}
      />
      <Text style={[Typography.micro, processingStyles.stateNote, { color: ts.text.onSurfaceVariant }]}>
        Determinate demo above. Omit progress when no measurable source exists and the same single indicator runs an indeterminate sweep.
      </Text>
      <AIProcessingSurface
        contextLabel="Reading shared receipt…"
        title="Analyzing Line Items"
        description="Extracting merchant, date, taxes, and categorizing into Dining…"
        onCancel={() => onAction('Processing cancelled')}
      />
      <View style={[processingStyles.matrix, !ts.isDark && processingStyles.matrixShadow, { backgroundColor: ts.raw.surface, borderColor: ts.raw.outline }]}>
        <View style={processingStyles.matrixHeader}>
          <Text style={[Typography.labelMd, { color: ts.text.onSurface, fontFamily: 'Manrope_700Bold' }]}>Parameterized Use-Cases</Text>
          <Text style={[Typography.micro, { color: ts.raw.primary, fontFamily: 'Manrope_600SemiBold' }]}>1 Component, 3 Flows</Text>
        </View>
        <View style={processingStyles.matrixList}>
          {processingFlows.map(({ Icon, label, context }) => (
            <View key={label} style={[processingStyles.matrixRow, { backgroundColor: ts.bg.low }]}>
              <View style={processingStyles.matrixRowLeft}>
                <Icon size={16} color={ts.text.onSurface} />
                <Text numberOfLines={1} style={[Typography.labelMd, processingStyles.matrixRowLabel, { color: ts.text.onSurface }]}>{label}</Text>
              </View>
              <Text numberOfLines={1} style={[Typography.labelMd, processingStyles.matrixRowContext, { color: ts.raw.primary }]}>{context}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

// Dev-only preview of the canonical M8 pair. Renders the real shared
// PeachTabBar twice (forced light and forced dark) plus the spec summary, so the
// showcase never holds a second tab-bar implementation.
export function TabBarShowcase({ active = 'home', onSelect, onAdd, onAction }: { active?: string; onSelect: (id: string) => void; onAdd: () => void; onAction?: (label: string) => void }) {
  const [fabOpen, setFabOpen] = useState(false);
  const tabs: PeachTabItem[] = [
    { key: 'home', label: 'Home', icon: Home },
    { key: 'insights', label: 'Insights', icon: BarChart2 },
    { key: 'chat', label: 'AI Chat', icon: MessageCircle },
    { key: 'profile', label: 'Profile', icon: User },
  ];
  const actions: PeachTabAction[] = [
    { key: 'scan', label: 'Scan', icon: <Scan color={DarkTheme.onSurface} size={20} />, color: LightTheme.primary, onPress: () => onAction?.('Scan action pressed') },
    { key: 'income', label: 'Income', icon: <ArrowDownLeft color={DarkTheme.onSurface} size={20} />, color: Colors.success, onPress: () => onAction?.('Income action pressed') },
    { key: 'expense', label: 'Expense', icon: <Edit3 color={DarkTheme.onSurface} size={20} />, color: LightTheme.primary, onPress: () => onAction?.('Expense action pressed') },
  ];
  const toggleFab = () => {
    setFabOpen(value => !value);
    onAdd();
  };
  const rule = (term: string, detail: string) => (
    <View style={tabBarShowcaseStyles.ruleRow}>
      <View style={[tabBarShowcaseStyles.ruleDot, { backgroundColor: LightTheme.primary }]} />
      <Text style={[Typography.micro, { color: LightTheme.onSurface, flexShrink: 1 }]}>
        <Text style={{ fontFamily: 'Manrope_700Bold' }}>{term} </Text>{detail}
      </Text>
    </View>
  );
  const block = (label: string, meta: string, tone: 'light' | 'dark') => {
    const isDark = tone === 'dark';
    const surface = isDark ? DarkTheme.background : LightTheme.background;
    const border = isDark ? DarkTheme.outline : LightTheme.outline;
    const labelColor = isDark ? DarkTheme.onSurface : LightTheme.onSurface;
    const metaColor = isDark ? DarkTheme.onSurfaceVariant : LightTheme.onSurfaceVariant;
    return (
      <View style={[tabBarShowcaseStyles.block, { backgroundColor: surface, borderColor: border, marginBottom: isDark ? 0 : Spacing.s6 }]}>
        <View style={tabBarShowcaseStyles.blockLabelRow}>
          <Text style={[Typography.captionBold, { color: labelColor, flexShrink: 1 }]}>{label}</Text>
          <Text style={[Typography.micro, { color: metaColor }]}>{meta}</Text>
        </View>
        <PeachTabBar
          tone={tone}
          tabs={tabs}
          activeKey={active}
          onSelect={onSelect}
          onFabPress={toggleFab}
          fabOpen={fabOpen}
          actions={actions}
        />
      </View>
    );
  };
  return (
    <View>
      <View style={tabBarShowcaseStyles.annotation}>
        <Text style={[Typography.labelMd, { color: LightTheme.onSurface, fontFamily: 'Manrope_700Bold', flexShrink: 1 }]}>Tab Bar & FAB (Scoop Notch)</Text>
        <View style={[tabBarShowcaseStyles.badge, { backgroundColor: LightTheme.purple100 }]}>
          <Text style={[Typography.micro, { color: LightTheme.primary, fontFamily: 'Manrope_600SemiBold' }]}>SVG Scoop</Text>
        </View>
      </View>
      <View style={[tabBarShowcaseStyles.rulesCard, { backgroundColor: LightTheme.surface, borderColor: LightTheme.outline }]}>
        {rule('Geometry:', 'Smooth concave cutout hugs 56px center FAB.')}
        {rule('Active State:', 'Icon-color switch to purple-600 ONLY (no background shape).')}
      </View>
      {block('Light Mode Implementation', 'White Surface + shadow-lg', 'light')}
      {block('Dark Mode Implementation', 'Surface #1C1730 + glow-lg', 'dark')}
    </View>
  );
}

export function ShowcaseCard({ title, children }: { title: string; children: React.ReactNode }) { const ts = useThemeStyles(); return <View style={styles.section}><Text style={[Typography.headlineSm, styles.sectionTitle, { color: ts.text.onSurface }]}>{title}</Text>{children}</View>; }

const styles = StyleSheet.create({
  section: { marginBottom: Spacing.s6 }, sectionTitle: { marginBottom: Spacing.s3 }, row: { flexDirection: 'row', gap: Spacing.s2, alignItems: 'center' }, currency: { minWidth: 56, minHeight: 48, paddingHorizontal: Spacing.s3, borderRadius: Radii.full, borderWidth: 1, alignItems: 'center', justifyContent: 'center' }, patternHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: Spacing.s2 }, smallButton: { flex: 1 }, duplicate: { borderWidth: 1, borderRadius: Radii.lg, padding: Spacing.s5, gap: Spacing.s2 }, amount: {},
});

const tabBarShowcaseStyles = StyleSheet.create({
  annotation: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.s2 },
  badge: { paddingHorizontal: Spacing.s2, paddingVertical: 2, borderRadius: Radii.full },
  rulesCard: { borderRadius: Radii.md, borderWidth: 1, padding: Spacing.s3, marginBottom: Spacing.s4, gap: Spacing.s1 },
  ruleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.s1 },
  ruleDot: { width: 8, height: 8, borderRadius: Radii.full, marginTop: 3 },
  block: { borderRadius: Radii.xl, borderWidth: 1, paddingTop: Spacing.s3, paddingBottom: Spacing.s2, overflow: 'hidden' },
  blockLabelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: Spacing.s4, marginBottom: Spacing.s2 },
});

export function ButtonsShowcase({ onAction }: { onAction: (action: string) => void }) {
  const light = LightTheme;
  const dark = DarkTheme;
  const report = (label: string) => () => onAction(`${label} pressed`);
  const specRow = (label: string, spec: string) => (
    <View style={buttonStyles.specRow}>
      <Text style={[Typography.labelMd, buttonStyles.specLabel, { color: light.onSurfaceVariant }]}>{label}</Text>
      <Text style={[Typography.labelMd, { color: light.onSurfaceVariant }]}>{spec}</Text>
    </View>
  );

  return (
    <View>
      <View style={[buttonStyles.lightPanel, { backgroundColor: light.background }]}>
        <View style={buttonStyles.blockHeader}>
          <Text style={[Typography.labelBold, { color: light.onSurface }]}>Full-Width States (Light Mode)</Text>
          <Text style={[Typography.labelMd, { color: light.onSurfaceVariant }]}>350px full width</Text>
        </View>
        <View style={buttonStyles.stack}>
          <View>
            {specRow('Primary Active', 'linear-gradient §1')}
            <PeachButton title="Save Expense" tone="light" fullWidth size="lg" onPress={report('Save Expense')} />
          </View>
          <View>
            {specRow('Secondary / Ghost', 'purple-100 fill')}
            <PeachButton title="Add Another Split" variant="secondary" tone="light" fullWidth size="lg" onPress={report('Add Another Split')} />
          </View>
          <View>
            {specRow('Destructive', 'danger pastel #FEE2E2')}
            <PeachButton title="Delete Transaction" variant="destructive" tone="light" fullWidth size="lg" onPress={report('Delete Transaction')} />
          </View>
          <View>
            {specRow('Loading State', 'SVG Spinner (Manrope bold)')}
            <PeachButton title="Syncing Receipt…" tone="light" fullWidth size="lg" isLoading onPress={report('Syncing Receipt')} />
          </View>
          <View>
            {specRow('Disabled', '#ECECF3 / #8B8B99')}
            <PeachButton title="Enter Amount to Continue" variant="disabled" tone="light" fullWidth size="lg" disabled onPress={report('Disabled')} />
          </View>
        </View>
      </View>

      <View style={[buttonStyles.card, { backgroundColor: light.surface, borderColor: light.outline }]}>
        <View style={buttonStyles.blockHeader}>
          <Text style={[Typography.labelBold, { color: light.onSurface }]}>Content-Width Sizing</Text>
          <Text style={[Typography.labelMd, { color: light.primary }]}>Auto padding 24px</Text>
        </View>
        <View style={buttonStyles.wrap}>
          <PeachButton title="Log" tone="light" size="sm" icon={<Plus size={16} color={Colors.white} strokeWidth={2.2} />} onPress={report('Log')} />
          <PeachButton title="Skip Note" variant="secondary" tone="light" size="sm" onPress={report('Skip Note')} />
          <PeachButton title="Remove" variant="destructive" tone="light" size="sm" icon={<Trash2 size={15} color={light.danger} strokeWidth={2} />} onPress={report('Remove')} />
          <PeachButton title="Inactive" variant="disabled" tone="light" size="sm" disabled onPress={report('Inactive')} />
        </View>
      </View>

      <View style={[buttonStyles.darkCard, { backgroundColor: dark.background, borderColor: dark.outline }]}>
        <View style={buttonStyles.blockHeader}>
          <View style={buttonStyles.titleRow}>
            <View style={[buttonStyles.dot, { backgroundColor: dark.primary }]} />
            <Text style={[Typography.labelBold, { color: dark.onSurface }]}>Dark Theme Matrix (§1 Tokens)</Text>
          </View>
          <Text style={[Typography.labelMd, { color: dark.onSurfaceVariant }]}>bg #0F0B1E</Text>
        </View>
        <View style={buttonStyles.stackSm}>
          <PeachButton title="Dark Primary (glow-lg)" tone="dark" fullWidth size="md" onPress={report('Dark Primary')} />
          <View style={buttonStyles.wrapTight}>
            <PeachButton title="Secondary (#2A1F52)" variant="secondary" tone="dark" size="xs" style={buttonStyles.grow} onPress={report('Dark Secondary')} />
            <PeachButton title="Destructive (#3A1A1A)" variant="destructive" tone="dark" size="xs" style={buttonStyles.grow} onPress={report('Dark Destructive')} />
          </View>
          <PeachButton title="Disabled (#241D3D)" variant="disabled" tone="dark" fullWidth size="xs" disabled onPress={report('Dark Disabled')} />
        </View>
      </View>
    </View>
  );
}

export function CardsShowcase({ stat, text, picker }: { stat: StatCardProps; text: TextCardProps; picker: PickerSheetProps }) {
  const ts = useThemeStyles();
  const annotation = (label: string, spec: string) => (
    <View style={cardStyles.annotation}>
      <Text style={[Typography.labelMd, cardStyles.annotationLabel, { color: ts.text.onSurface }]}>{label}</Text>
      <Text style={[Typography.micro, cardStyles.annotationSpec, { color: ts.text.primary }]}>{spec}</Text>
    </View>
  );
  return (
    <View>
      {annotation('1. StatCard (Hero & Pacing)', 'radius-xl (28px) · Gradient')}
      <StatCard {...stat} />
      <View style={cardStyles.gap} />
      {annotation('2. TextCard (Weekly Digest / FAQ)', 'radius-lg (20px) · White Surface')}
      <TextCard {...text} />
      <View style={cardStyles.gap} />
      {annotation('3. PickerSheet (Modal Bottom Sheet)', 'radius-xl top (28px) · Handle')}
      <PickerSheet {...picker} />
    </View>
  );
}

const cardStyles = StyleSheet.create({
  annotation: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: Spacing.s1, paddingHorizontal: Spacing.s1, gap: Spacing.s2 },
  annotationLabel: { fontFamily: 'Manrope_700Bold', flexShrink: 1 },
  annotationSpec: { fontFamily: 'Manrope_600SemiBold', textAlign: 'right' },
  gap: { height: Spacing.s5 },
});

const processingStyles = StyleSheet.create({
  annotation: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.s2, paddingHorizontal: Spacing.s1, gap: Spacing.s2 },
  annotationLabel: { fontFamily: 'Manrope_700Bold', flexShrink: 1 },
  badge: { borderRadius: Radii.full, paddingHorizontal: Spacing.s2, paddingVertical: 2, alignItems: 'center', justifyContent: 'center' },
  stateNote: { marginTop: Spacing.s2, marginBottom: Spacing.s5, textAlign: 'center' },
  matrix: { borderWidth: 1, borderRadius: Radii.lg, padding: Spacing.s4, marginTop: Spacing.s5 },
  matrixShadow: { shadowColor: LightTheme.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.12, shadowRadius: 12, elevation: 3 },
  matrixHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.s2, gap: Spacing.s2 },
  matrixList: { gap: Spacing.s2 },
  matrixRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.s2, padding: Spacing.s2, borderRadius: Radii.sm },
  matrixRowLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.s2, flexShrink: 1 },
  matrixRowLabel: { fontFamily: 'Manrope_700Bold', flexShrink: 1 },
  matrixRowContext: { fontFamily: 'Manrope_500Medium', flexShrink: 1, textAlign: 'right' },
});

const buttonStyles = StyleSheet.create({
  lightPanel: { borderRadius: Radii.lg, padding: 0, marginBottom: Spacing.s6 },
  blockHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.s3, gap: Spacing.s2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },
  dot: { width: 10, height: 10, borderRadius: Radii.full, marginRight: Spacing.s2 },
  stack: { gap: Spacing.s3 },
  stackSm: { gap: Spacing.s2 },
  specRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: Spacing.s1, marginBottom: Spacing.s1, gap: Spacing.s2 },
  specLabel: { fontWeight: '600' },
  card: {
    borderRadius: Radii.lg,
    borderWidth: 1,
    padding: Spacing.s4,
    marginBottom: Spacing.s6,
    shadowColor: LightTheme.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 3,
  },
  darkCard: {
    borderRadius: Radii.xl,
    borderWidth: 1,
    padding: Spacing.s4,
    marginBottom: Spacing.s6,
    shadowColor: LightTheme.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16,
    shadowRadius: 24,
    elevation: 6,
  },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.s2, alignItems: 'center' },
  wrapTight: { flexDirection: 'row', gap: Spacing.s2, alignItems: 'center' },
  grow: { flexGrow: 1, flexShrink: 1 },
});

const numpadStyles = StyleSheet.create({
  annotation: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: Spacing.s2, paddingHorizontal: Spacing.s1, gap: Spacing.s2 },
  badge: { borderRadius: Radii.full, paddingHorizontal: Spacing.s2, paddingVertical: 2, alignItems: 'center', justifyContent: 'center' },
  callouts: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.s2, marginTop: Spacing.s5 },
  callout: { flexGrow: 1, flexBasis: 140, borderWidth: 1, borderRadius: Radii.md, padding: Spacing.s3 },
  calloutTitle: { fontFamily: 'Manrope_700Bold', marginBottom: 2 },
});

const categoryStyles = StyleSheet.create({
  annotation: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: Spacing.s2, paddingHorizontal: Spacing.s1, gap: Spacing.s2 },
  gridBadge: { borderRadius: Radii.full, paddingHorizontal: Spacing.s2, paddingVertical: 2, alignItems: 'center', justifyContent: 'center' },
  legendCard: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: Spacing.s2, columnGap: Spacing.s4, borderWidth: 1, borderRadius: Radii.md, padding: Spacing.s3, marginBottom: Spacing.s4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: Spacing.s1 },
  legendDot: { width: 12, height: 12, borderRadius: Radii.full },
  darkBox: { borderWidth: 1, borderRadius: Radii.lg, padding: Spacing.s4, marginTop: Spacing.s4 },
  darkHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.s3, gap: Spacing.s2 },
  darkGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  darkCell: { width: '25%', alignItems: 'center', paddingHorizontal: Spacing.s1, marginBottom: Spacing.s2 },
  darkChip: { width: 48, height: 48, borderRadius: Radii.sm, alignItems: 'center', justifyContent: 'center' },
});

const currencyStyles = StyleSheet.create({
  stack: { gap: Spacing.s5 },
  quickCard: { borderWidth: 1, borderRadius: Radii.xl, padding: Spacing.s4 },
  // HTML quick card uses shadow-sm; dark replaces shadow with border per design system 5a.
  quickCardShadow: { shadowColor: LightTheme.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.12, shadowRadius: 12, elevation: 3 },
  quickHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.s2, marginBottom: Spacing.s2 },
  quickTitle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.s2, flexShrink: 1 },
  dot: { width: 10, height: 10, borderRadius: Radii.full },
  annotation: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingHorizontal: Spacing.s1, gap: Spacing.s2 },
  sheetPreview: { borderWidth: 1, borderTopLeftRadius: Radii.xl, borderTopRightRadius: Radii.xl, overflow: 'hidden' },
});

const searchStyles = StyleSheet.create({
  annotation: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.s2, paddingHorizontal: Spacing.s1, gap: Spacing.s2 },
  annotationRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.s1 },
  badge: { borderRadius: Radii.full, paddingHorizontal: Spacing.s2, paddingVertical: 2, alignItems: 'center', justifyContent: 'center' },
  card: { borderWidth: 1, borderRadius: Radii.xl, padding: Spacing.s4, marginBottom: Spacing.s5 },
  // HTML 42 uses mb-6 (24) for the collapsed card; the expanded card (HTML 67) keeps mb-5 (20).
  cardCollapsedMb: { marginBottom: Spacing.s6 },
  cardShadowSm: { shadowColor: LightTheme.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.12, shadowRadius: 12, elevation: 3 },
  cardShadowMd: { shadowColor: LightTheme.primary, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.16, shadowRadius: 24, elevation: 6 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: Spacing.s2, gap: Spacing.s2 },
  cardDescription: { marginBottom: Spacing.s3 },
  contextBox: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.s2, borderWidth: 1, borderRadius: Radii.lg, padding: Spacing.s3 },
  contextTitle: { flexShrink: 1 },
  hint: { paddingVertical: Spacing.s5, textAlign: 'center' },
});
