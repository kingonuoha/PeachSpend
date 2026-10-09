import React, { useCallback, useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowLeft, ShieldCheck, Sparkles } from 'lucide-react-native';

import { LuminousCard } from '../../components/ui/LuminousCard';
import { ScalePressable } from '../../components/ui/ScalePressable';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import { Colors, Gradients, LightTheme, Radii, Spacing, Typography } from '../../constants/tokens';

// S-20 What's New (FR-20.1). Full-file replacement of the legacy screen. The
// safe-area header, hero version card, summary stats, release card and quiet
// footer follow the locked canonical pair; the version is the real installed
// app version and the entries are the existing v1 changelog kept unchanged per
// FR-20.1. Static compiled content: no DB read, no SQL, no AI call and no
// network. See the E14 escalations for the canonical pair's fabricated version
// history, which is not shipped.

const MAX_CONTENT_WIDTH = 640;
const BACK_SIZE = 40;
const CONTROL_HIT_SLOP = { top: 2, bottom: 2, left: 2, right: 2 };
const HERO_CHIP_SIZE = 40;
const HERO_RADIUS = Radii.xl;
const GLOW_SIZE = 144;
// Canonical NEW/FIX pill radius is 4px (`rounded`); no radius token is that
// small, so it is carried literally.
const TAG_RADIUS = 4;
// Hero gradient is the shared brand pair; same 160deg stop layout as PeachButton.
const GRADIENT_START = { x: 0.33, y: 0 };
const GRADIENT_END = { x: 0.67, y: 1 };
const GRADIENT_LOCATIONS: [number, number, number] = [0, 0.45, 1];
// The hero gradient is dark in both themes, so the "Latest" pill keeps a fixed
// emerald-on-dark trio for contrast instead of a theme token that flips value.
const LATEST_BG = 'rgba(52, 211, 153, 0.20)';
const LATEST_BORDER = 'rgba(52, 211, 153, 0.40)';
const LATEST_TEXT = '#6EE7B7';

type ChangeKind = 'new' | 'fix';

interface ChangelogEntry {
  type: ChangeKind;
  text: string;
}

// Existing v1 changelog entries, preserved verbatim (FR-20.1). No fabricated
// version, date or build data is attached to them.
const CHANGELOG: ChangelogEntry[] = [
  { type: 'new', text: 'Personalised AI chat assistant: ask questions about your spending, get budget coaching, and log expenses by typing naturally' },
  { type: 'new', text: 'Switch between Gemini and OpenRouter AI providers with a choice of models including Claude Sonnet, GPT-4o, and more' },
  { type: 'new', text: 'Attach receipt images directly in chat for AI analysis and expense extraction' },
  { type: 'new', text: 'Conversation history persists across sessions and auto-clears after 7 days of inactivity' },
  { type: 'new', text: 'Suggested questions and onboarding welcome screen when opening AI chat for the first time' },
  { type: 'new', text: 'Markdown formatting and typewriter animation in AI responses for a natural reading experience' },
  { type: 'new', text: 'Undo countdown timer on chat-logged expenses: 10 seconds to reverse any mistake' },
  { type: 'new', text: 'Scan receipts with AI and auto-fill expense details' },
  { type: 'new', text: 'Import expenses from CSV files exported from PeachSpend' },
  { type: 'new', text: 'Import expenses using AI: describe your spending and get structured data' },
  { type: 'new', text: 'Auto-create categories from AI imports with default icons and colors' },
  { type: 'new', text: 'Share receipts from other apps directly into PeachSpend for scanning' },
  { type: 'new', text: 'Background recurring check keeps expenses up to date even when the app is closed' },
  { type: 'fix', text: 'AI spending queries now scoped to the current month: no more lifetime totals mixed in' },
  { type: 'fix', text: 'Duplicate expense detection when logging via chat: warns before saving' },
  { type: 'fix', text: 'Keyboard now dismisses when scrolling the chat message list' },
  { type: 'fix', text: 'Input bar auto-focuses when chat opens for faster typing' },
  { type: 'fix', text: 'Message timestamps grouped by day with Today/Yesterday/date separators' },
  { type: 'fix', text: 'Missed recurring expenses auto-generate when you open the app' },
  { type: 'fix', text: 'Category colors and icons now appear correctly in import previews' },
  { type: 'fix', text: 'Export saves a copy to Downloads/PeachSpend/ folder on Android' },
  { type: 'fix', text: 'Confirmation prompt before discarding unsaved scanned items' },
  { type: 'fix', text: 'Spending analytics use your currency symbol and category colors' },
];

export default function WhatsNewScreen() {
  const ts = useThemeStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const appVersion = Constants.expoConfig?.version;
  const cardVariant = ts.isDark ? 'low' : 'high';

  const newCount = useMemo(() => CHANGELOG.filter((entry) => entry.type === 'new').length, []);
  const fixCount = useMemo(() => CHANGELOG.filter((entry) => entry.type === 'fix').length, []);
  const totalCount = CHANGELOG.length;

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/settings');
  }, [router]);

  const gradient = ts.isDark ? Gradients.dark : Gradients.light;

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: ts.bg.screen }]} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />

      <View
        style={[
          styles.header,
          { borderBottomColor: ts.raw.outline, backgroundColor: ts.bg.screen },
        ]}
      >
        <ScalePressable
          onPress={goBack}
          accessibilityRole="button"
          accessibilityLabel="Back to Settings"
          hitSlop={CONTROL_HIT_SLOP}
          style={[
            styles.backControl,
            {
              backgroundColor: ts.isDark ? ts.raw.surface : ts.bg.elevated,
              borderColor: ts.raw.outline,
            },
          ]}
        >
          <ArrowLeft size={20} color={ts.raw.onSurface} strokeWidth={2.2} />
        </ScalePressable>

        <View style={styles.headerText}>
          <Text
            style={[Typography.headlineMd, { color: ts.raw.onSurface }]}
            numberOfLines={1}
            accessibilityRole="header"
          >
            What&apos;s New
          </Text>
          <Text
            style={[Typography.micro, { color: ts.raw.onSurfaceVariant }]}
            numberOfLines={1}
          >
            Version &amp; update history
          </Text>
        </View>

        {appVersion ? (
          <View
            style={[
              styles.versionPill,
              { backgroundColor: ts.raw.purple100, borderColor: ts.raw.primary + '33' },
            ]}
          >
            <Sparkles size={14} color={ts.raw.primary} strokeWidth={2} />
            <Text style={[Typography.micro, styles.versionPillText, { color: ts.raw.primary }]}>
              v{appVersion}
            </Text>
          </View>
        ) : null}
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { paddingBottom: Spacing.s8 + insets.bottom }]}
      >
        <LinearGradient
          colors={gradient}
          locations={GRADIENT_LOCATIONS}
          start={GRADIENT_START}
          end={GRADIENT_END}
          style={styles.hero}
        >
          <View
            pointerEvents="none"
            accessible={false}
            importantForAccessibility="no-hide-descendants"
            style={[styles.heroGlow, { backgroundColor: ts.raw.primaryContainer + '33' }]}
          />

          <View style={styles.heroTop}>
            <View
              style={styles.heroChip}
              accessible={false}
              importantForAccessibility="no-hide-descendants"
            >
              <Sparkles size={20} color={Colors.white} strokeWidth={2} />
            </View>
            <View style={styles.heroTitleBlock}>
              <View style={styles.heroOverlineRow}>
                <Text style={[Typography.micro, styles.heroOverline]}>Current release</Text>
                <View style={styles.latestPill}>
                  <Text style={[Typography.micro, styles.latestText]}>Latest</Text>
                </View>
              </View>
              {appVersion ? (
                <Text style={[Typography.headlineSm, styles.heroTitle]} numberOfLines={1}>
                  Version {appVersion}
                </Text>
              ) : null}
            </View>
          </View>

          <View style={styles.heroDivider}>
            <Text style={[Typography.micro, styles.heroMeta]}>{totalCount} documented changes</Text>
          </View>
          <Text style={[Typography.labelMd, styles.heroBody]}>
            A factual record of what changed in this version of PeachSpend, newest first.
          </Text>
        </LinearGradient>

        <View style={styles.statsRow}>
          <LuminousCard
            variant={cardVariant}
            style={[styles.statCard, !ts.isDark ? styles.cardShadow : null]}
          >
            <Text style={[Typography.micro, { color: ts.raw.onSurfaceVariant }]}>
              New capabilities
            </Text>
            <View style={styles.statValueRow}>
              <Text
                style={[Typography.headlineSm, { color: ts.raw.onSurface }]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.7}
              >
                {newCount}
              </Text>
              <View style={[styles.tag, { backgroundColor: ts.raw.purple100 }]}>
                <Text style={[Typography.micro, styles.tagText, { color: ts.raw.primary }]}>
                  NEW
                </Text>
              </View>
            </View>
          </LuminousCard>

          <LuminousCard
            variant={cardVariant}
            style={[styles.statCard, !ts.isDark ? styles.cardShadow : null]}
          >
            <Text style={[Typography.micro, { color: ts.raw.onSurfaceVariant }]}>
              Reliability &amp; fixes
            </Text>
            <View style={styles.statValueRow}>
              <Text
                style={[Typography.headlineSm, { color: ts.raw.onSurface }]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.7}
              >
                {fixCount}
              </Text>
              <View style={[styles.tag, { backgroundColor: ts.raw.statusSuccessContainer }]}>
                <Text style={[Typography.micro, styles.tagText, { color: ts.raw.statusSuccessText }]}>
                  FIX
                </Text>
              </View>
            </View>
          </LuminousCard>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={[Typography.bodyBold, { color: ts.raw.onSurface }]}>Release history</Text>
          <Text style={[Typography.micro, { color: ts.raw.onSurfaceVariant }]}>
            {totalCount} entries
          </Text>
        </View>

        <LuminousCard
          variant={cardVariant}
          style={[styles.releaseCard, !ts.isDark ? styles.cardShadow : null]}
        >
          <View
            style={[
              styles.releaseHeader,
              {
                backgroundColor: ts.isDark ? ts.bg.card : ts.bg.low,
                borderBottomColor: ts.raw.outline,
              },
            ]}
          >
            <View style={styles.releaseHeaderLeft}>
              <View
                style={[styles.releaseDot, { backgroundColor: ts.raw.primary }]}
                accessible={false}
                importantForAccessibility="no-hide-descendants"
              />
              <Text
                style={[Typography.labelBold, { color: ts.raw.onSurface }]}
                numberOfLines={1}
              >
                {appVersion ? `Version ${appVersion}` : 'Release notes'}
              </Text>
              <View style={[styles.tag, { backgroundColor: ts.raw.purple100 }]}>
                <Text style={[Typography.micro, styles.tagText, { color: ts.raw.primary }]}>
                  Current
                </Text>
              </View>
            </View>
          </View>

          {CHANGELOG.map((entry, index) => {
            const isNew = entry.type === 'new';
            return (
              <View
                key={`${entry.type}-${index}`}
                style={[
                  styles.itemRow,
                  index < totalCount - 1
                    ? { borderBottomWidth: 1, borderBottomColor: ts.raw.outline }
                    : null,
                ]}
              >
                <View
                  style={[
                    styles.tag,
                    styles.itemTag,
                    {
                      backgroundColor: isNew
                        ? ts.raw.purple100
                        : ts.raw.statusSuccessContainer,
                    },
                  ]}
                >
                  <Text
                    style={[
                      Typography.micro,
                      styles.tagText,
                      { color: isNew ? ts.raw.primary : ts.raw.statusSuccessText },
                    ]}
                  >
                    {isNew ? 'NEW' : 'FIX'}
                  </Text>
                </View>
                <Text style={[Typography.labelMd, styles.itemText, { color: ts.raw.onSurface }]}>
                  {entry.text}
                </Text>
              </View>
            );
          })}
        </LuminousCard>

        <View style={styles.footer}>
          <View
            style={[
              styles.footerPill,
              {
                backgroundColor: ts.isDark ? ts.raw.surface : ts.bg.elevated,
                borderColor: ts.raw.outline,
              },
            ]}
          >
            <ShieldCheck size={14} color={ts.raw.primary} strokeWidth={2} />
            <Text style={[Typography.micro, { color: ts.raw.onSurfaceVariant }]}>
              {appVersion ? `PeachSpend v${appVersion}` : 'PeachSpend'}
            </Text>
          </View>
          <Text style={[Typography.micro, styles.footerCopy, { color: ts.raw.onSurfaceVariant }]}>
            Your ledger stays on this device.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s3,
    paddingHorizontal: Spacing.s5,
    paddingVertical: Spacing.s3,
    borderBottomWidth: 1,
  },
  backControl: {
    width: BACK_SIZE,
    height: BACK_SIZE,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  versionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s1,
    paddingHorizontal: Spacing.s2,
    paddingVertical: Spacing.s1,
    borderRadius: Radii.full,
    borderWidth: 1,
  },
  versionPillText: {
    fontFamily: 'Manrope_700Bold',
  },
  content: {
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: 'center',
    paddingHorizontal: Spacing.s5,
    paddingVertical: Spacing.s4,
    gap: Spacing.s5,
  },
  hero: {
    borderRadius: HERO_RADIUS,
    padding: Spacing.s5,
    overflow: 'hidden',
  },
  heroGlow: {
    position: 'absolute',
    right: -Spacing.s7,
    bottom: -Spacing.s7,
    width: GLOW_SIZE,
    height: GLOW_SIZE,
    borderRadius: GLOW_SIZE / 2,
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s3,
  },
  heroChip: {
    width: HERO_CHIP_SIZE,
    height: HERO_CHIP_SIZE,
    borderRadius: Radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.20)',
  },
  heroTitleBlock: {
    flex: 1,
    minWidth: 0,
  },
  heroOverlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s2,
  },
  heroOverline: {
    fontFamily: 'Manrope_600SemiBold',
    color: 'rgba(255,255,255,0.70)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  latestPill: {
    paddingHorizontal: Spacing.s2,
    paddingVertical: 2,
    borderRadius: Radii.full,
    borderWidth: 1,
    backgroundColor: LATEST_BG,
    borderColor: LATEST_BORDER,
  },
  latestText: {
    fontFamily: 'Manrope_700Bold',
    color: LATEST_TEXT,
  },
  heroTitle: {
    color: Colors.white,
    marginTop: 2,
  },
  heroDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.s4,
    paddingTop: Spacing.s3,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.15)',
  },
  heroMeta: {
    color: 'rgba(255,255,255,0.80)',
  },
  heroBody: {
    color: 'rgba(255,255,255,0.90)',
    marginTop: Spacing.s2,
  },
  statsRow: {
    flexDirection: 'row',
    gap: Spacing.s3,
  },
  statCard: {
    flex: 1,
    minWidth: 0,
    padding: Spacing.s3,
  },
  statValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.s2,
    marginTop: Spacing.s1,
  },
  tag: {
    paddingHorizontal: Spacing.s2,
    paddingVertical: 2,
    borderRadius: TAG_RADIUS,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  tagText: {
    fontFamily: 'Manrope_700Bold',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.s2,
  },
  releaseCard: {
    padding: 0,
  },
  releaseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.s4,
    paddingVertical: Spacing.s3,
    borderBottomWidth: 1,
  },
  releaseHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s2,
    flex: 1,
    minWidth: 0,
  },
  releaseDot: {
    width: 8,
    height: 8,
    borderRadius: Radii.full,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.s3,
    paddingHorizontal: Spacing.s3,
    paddingVertical: Spacing.s3,
  },
  itemTag: {
    marginTop: 2,
    flexShrink: 0,
  },
  itemText: {
    flex: 1,
    minWidth: 0,
  },
  footer: {
    alignItems: 'center',
    paddingVertical: Spacing.s5,
    gap: Spacing.s2,
  },
  footerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s1,
    paddingHorizontal: Spacing.s3,
    paddingVertical: Spacing.s1,
    borderRadius: Radii.full,
    borderWidth: 1,
  },
  footerCopy: {
    textAlign: 'center',
  },
  cardShadow: {
    shadowColor: LightTheme.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 3,
  },
});
