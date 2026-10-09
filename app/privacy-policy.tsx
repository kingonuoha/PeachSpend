import React, { useCallback } from 'react';
import { ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { ArrowLeft, Calendar, Check, Share2, ShieldCheck } from 'lucide-react-native';

import { LuminousCard } from '../components/ui/LuminousCard';
import { PeachButton } from '../components/ui/PeachButton';
import { ScalePressable } from '../components/ui/ScalePressable';
import { useThemeStyles } from '../hooks/useThemeStyles';
import { Colors, Radii, Spacing, Typography } from '../constants/tokens';

// S-18 Privacy Policy (FR-18.1). Rebuilt as the single S-18 surface: boxed
// full-file replacement of the legacy screen. Structure and tokens follow the
// locked canonical pair; the section copy is the honest Phase 05R I7 AI-egress
// disclosure, which names both providers and the exact per-feature egress.
// Static, read-only content: no data read, no SQL, no AI call and no network.

const MAX_CONTENT_WIDTH = 640;
const BACK_SIZE = 40;
const CONTROL_HIT_SLOP = { top: 2, bottom: 2, left: 2, right: 2 };
const HERO_ICON_SIZE = 44;
const CLAUSE_NUMBER_SIZE = 20;
const GLOW_SIZE = 144;
const HERO_RADIUS = Radii.xl;

interface PolicyClause {
  id: number;
  title: string;
  body: string;
}

// Six canonical clause slots. Copy carried from Phase 05R I7; the design's own
// illustrative clause bodies are not used where they would assert something the
// shipped app does not do (see escalations). No emoji, no em dash.
const CLAUSES: PolicyClause[] = [
  {
    id: 1,
    title: 'Information We Collect',
    body:
      'We collect the minimum data required to provide expense tracking: transaction details you enter (amounts, merchants, categories, notes), receipt images you choose to scan, and app preferences such as theme and currency. We do not collect location data, contacts, or personal identifiers beyond your chosen profile name.',
  },
  {
    id: 2,
    title: 'How Your Data Is Processed',
    body:
      'Your data powers the app features: categorizing expenses, generating insights, and improving scan accuracy. All financial calculations, budget comparisons, recurring triggers, and recap summaries run on your device. The only network requests the app makes are the AI feature requests you trigger, and those go only to the AI provider you configure yourself in AI Chat Settings, either Google Gemini or OpenRouter. No AI provider is contacted unless you use an AI feature.',
  },
  {
    id: 3,
    title: 'AI Interactions & Provider Security',
    body:
      'When you use an AI feature, only these items are sent to your configured provider. Receipt scanning sends the receipt image you choose, for text extraction. AI chat sends your message plus a bounded snapshot of ledger context (totals, category breakdown, and recent merchant names and amounts) so the assistant can answer. Semantic search sends the text of candidate transactions (merchant, category, and note only when relevant) for ranking. The Insights narrative and digest send aggregate totals only, never individual transactions. You choose which provider to use and supply your own API key in AI Chat Settings; the key is held in device secure keychain storage and is never proxied through PeachSpend.',
  },
  {
    id: 4,
    title: 'Local Storage',
    body:
      'All data is stored locally on your device using SQLite, sandboxed by the operating system. There is no PeachSpend server: your data is not sent to us and we cannot see it. Only the AI feature requests you trigger reach the provider you configure. You can export all categorized entries at any time, and you can delete your data from Settings, Data Stewardship.',
  },
  {
    id: 5,
    title: 'Third-Party Disclosures',
    body:
      'PeachSpend does not partner with data brokers, ad networks, or behavioral analytics. We do not inject tracking pixels, behavioral SDKs, or third-party marketing beacons into any view. The only third party that can receive your data is the AI provider you configure. PeachSpend includes no analytics and no crash reporting.',
  },
  {
    id: 6,
    title: 'Data Portability & Instant Erasure',
    body:
      'You retain full ownership of your ledger. You can export, modify, or permanently delete your data from within the app at any time. No account is required. Nothing leaves your device to any PeachSpend server or third party except the AI feature requests you trigger with your own configured provider.',
  },
];

// Static policy content is the only "data" this screen has. Building the share
// payload from the same array keeps the header share honest with no separate
// copy and no prototype-only toast.
function buildShareMessage(): string {
  const sections = CLAUSES.map((clause) => `${clause.title}\n${clause.body}`).join('\n\n');
  return `PeachSpend Privacy Policy\nYour Data, Your Control\n\n${sections}`;
}

export default function PrivacyPolicyScreen() {
  const ts = useThemeStyles();
  const router = useRouter();
  const appVersion = Constants.expoConfig?.version;

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/settings');
  }, [router]);

  const sharePolicy = useCallback(() => {
    void Share.share({ message: buildShareMessage() });
  }, []);

  const cardVariant = ts.isDark ? 'low' : 'high';
  // Header controls: design bg-[#ECECF3] light / bg-[#1C1730] dark. Light is the
  // elevated canvas tone and dark is the raised sheet surface, so mode-select
  // rather than a single token that is wrong in one mode.
  const controlSurface = ts.isDark ? ts.raw.surface : ts.bg.elevated;

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
          style={[styles.control, { backgroundColor: controlSurface, borderColor: ts.raw.outline }]}
        >
          <ArrowLeft size={20} color={ts.raw.onSurface} strokeWidth={2.2} />
        </ScalePressable>

        <View style={styles.headerText}>
          <Text
            style={[Typography.micro, styles.overline, { color: ts.raw.onSurfaceVariant }]}
            numberOfLines={1}
          >
            Legal &amp; Transparency
          </Text>
          <Text
            style={[Typography.labelBold, { color: ts.raw.onSurface }]}
            numberOfLines={1}
            accessibilityRole="header"
          >
            Privacy Policy
          </Text>
        </View>

        <ScalePressable
          onPress={sharePolicy}
          accessibilityRole="button"
          accessibilityLabel="Share Privacy Policy"
          hitSlop={CONTROL_HIT_SLOP}
          style={[styles.control, { backgroundColor: controlSurface, borderColor: ts.raw.outline }]}
        >
          <Share2 size={16} color={ts.raw.onSurfaceVariant} />
        </ScalePressable>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        <LuminousCard
          variant={cardVariant}
          style={[styles.hero, !ts.isDark ? styles.cardShadow : null]}
        >
          <View
            pointerEvents="none"
            accessible={false}
            importantForAccessibility="no-hide-descendants"
            style={[
              styles.heroGlow,
              { backgroundColor: ts.raw.primary, opacity: ts.isDark ? 0.14 : 0.08 },
            ]}
          />

          <View style={styles.heroHeader}>
            <View
              style={[
                styles.heroIcon,
                { backgroundColor: ts.raw.purple100, borderColor: ts.raw.primary + '33' },
              ]}
            >
              <ShieldCheck size={24} color={ts.raw.primary} strokeWidth={2.2} />
            </View>
            <View style={styles.heroTitleBlock}>
              <View
                style={[
                  styles.heroPill,
                  { backgroundColor: ts.raw.purple100, borderColor: ts.raw.primary + '22' },
                ]}
              >
                <Text
                  style={[
                    Typography.micro,
                    styles.overline,
                    styles.heroPillWeight,
                    { color: ts.raw.primary },
                  ]}
                >
                  Zero Commercial Brokering
                </Text>
              </View>
              <Text
                accessibilityRole="header"
                style={[Typography.headlineMd, styles.heroTitle, { color: ts.raw.onSurface }]}
              >
                Your Data, Your Control
              </Text>
            </View>
          </View>

          <Text style={[Typography.bodyRegular, { color: ts.raw.onSurfaceVariant }]}>
            PeachSpend is built to keep your financial ledger confidential. We do not sell your
            personal data, profile your purchases for advertising, or monetize your spending
            behaviors.
          </Text>

          <View style={[styles.trustRow, { borderTopColor: ts.raw.outline }]}>
            <View style={styles.trustBadge}>
              <Check size={14} color={Colors.success} strokeWidth={2} />
              <Text style={[Typography.labelMd, styles.trustText, { color: ts.raw.onSurface }]}>
                Local-first SQLite
              </Text>
            </View>
            <View style={styles.trustBadge}>
              <Check size={14} color={Colors.success} strokeWidth={2} />
              <Text style={[Typography.labelMd, styles.trustText, { color: ts.raw.onSurface }]}>
                Zero data harvesting
              </Text>
            </View>
          </View>
        </LuminousCard>

        {CLAUSES.map((clause) => (
          <LuminousCard
            key={clause.id}
            variant={cardVariant}
            style={[styles.clause, !ts.isDark ? styles.cardShadow : null]}
          >
            <View style={styles.clauseHeader}>
              <View
                accessible={false}
                importantForAccessibility="no-hide-descendants"
                style={[styles.clauseNumber, { backgroundColor: ts.raw.purple100 }]}
              >
                <Text style={[Typography.micro, styles.clauseNumberText, { color: ts.raw.primary }]}>
                  {clause.id}
                </Text>
              </View>
              <Text
                accessibilityRole="header"
                style={[Typography.labelBold, styles.clauseTitle, { color: ts.raw.onSurface }]}
              >
                {clause.title}
              </Text>
            </View>
            <Text style={[Typography.bodyRegular, { color: ts.raw.onSurfaceVariant }]}>
              {clause.body}
            </Text>
          </LuminousCard>
        ))}

        <LuminousCard
          variant={cardVariant}
          style={[styles.footer, { backgroundColor: ts.raw.surface + '99' }]}
        >
          <View style={styles.footerDateRow}>
            <Calendar size={14} color={ts.raw.primary} />
            <Text style={[Typography.labelMd, styles.footerDate, { color: ts.raw.onSurfaceVariant }]}>
              Last updated: May 2026
            </Text>
          </View>
          {appVersion ? (
            <Text
              style={[Typography.micro, styles.footerSubline, { color: ts.raw.onSurfaceVariant }]}
            >
              Version {appVersion}. Your data stays on this device.
            </Text>
          ) : null}
          <View style={styles.footerAction}>
            <PeachButton
              title="Return to Settings"
              onPress={goBack}
              variant="secondary"
              size="lg"
              fullWidth
            />
          </View>
        </LuminousCard>
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
    justifyContent: 'space-between',
    gap: Spacing.s3,
    paddingHorizontal: Spacing.s5,
    paddingVertical: Spacing.s2,
    borderBottomWidth: 1,
  },
  control: {
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
    alignItems: 'center',
  },
  overline: {
    fontFamily: 'Manrope_600SemiBold',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  heroPillWeight: {
    // Design hero pill is font-bold; the shared overline is font-semibold.
    fontFamily: 'Manrope_700Bold',
  },
  content: {
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: 'center',
    paddingHorizontal: Spacing.s5,
    paddingVertical: Spacing.s5,
    gap: Spacing.s5,
  },
  hero: {
    borderRadius: HERO_RADIUS,
    padding: Spacing.s5,
    position: 'relative',
  },
  cardShadow: {
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 3,
  },
  heroGlow: {
    position: 'absolute',
    top: -Spacing.s8,
    right: -Spacing.s8,
    width: GLOW_SIZE,
    height: GLOW_SIZE,
    borderRadius: GLOW_SIZE / 2,
  },
  heroHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.s3,
    marginBottom: Spacing.s3,
  },
  heroIcon: {
    width: HERO_ICON_SIZE,
    height: HERO_ICON_SIZE,
    borderRadius: Radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  heroTitleBlock: {
    flex: 1,
    minWidth: 0,
    alignItems: 'flex-start',
  },
  heroPill: {
    paddingHorizontal: Spacing.s2,
    paddingVertical: 2,
    borderRadius: Radii.full,
    borderWidth: 1,
    marginBottom: Spacing.s1,
  },
  heroTitle: {
    lineHeight: 24,
  },
  trustRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s2,
    marginTop: Spacing.s4,
    paddingTop: Spacing.s3,
    borderTopWidth: 1,
  },
  trustBadge: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s1,
  },
  trustText: {
    fontFamily: 'Manrope_500Medium',
    flexShrink: 1,
  },
  clause: {
    borderRadius: Radii.md,
    padding: Spacing.s4,
  },
  clauseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s2,
    marginBottom: Spacing.s2,
  },
  clauseNumber: {
    width: CLAUSE_NUMBER_SIZE,
    height: CLAUSE_NUMBER_SIZE,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clauseNumberText: {
    fontFamily: 'Manrope_700Bold',
  },
  clauseTitle: {
    flex: 1,
    minWidth: 0,
  },
  footer: {
    borderRadius: Radii.md,
    padding: Spacing.s4,
    alignItems: 'center',
    gap: Spacing.s2,
  },
  footerDateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s1,
  },
  footerDate: {
    fontFamily: 'Manrope_600SemiBold',
  },
  footerSubline: {
    textAlign: 'center',
  },
  footerAction: {
    width: '100%',
    marginTop: Spacing.s1,
  },
});
