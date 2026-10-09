import React, { useCallback, useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import Constants from 'expo-constants';
import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowLeft, Info, LifeBuoy, Mail, Phone, Send } from 'lucide-react-native';

import { LuminousCard } from '../components/ui/LuminousCard';
import { PeachButton } from '../components/ui/PeachButton';
import { ScalePressable } from '../components/ui/ScalePressable';
import { useToast } from '../components/ui/ToastProvider';
import { useThemeStyles } from '../hooks/useThemeStyles';
import { CategoryTints, Colors, Gradients, Radii, Spacing, Typography } from '../constants/tokens';

// S-19 Support Center (FR-19.1-FR-19.3). Full-file replacement of the legacy
// screen. Structure, hierarchy and tokens follow the locked canonical pair;
// the contact details, four FAQ items and response-time copy are the real v1
// content required unchanged by FR-19.1/FR-19.2 (see the E13 escalations for
// the canonical copy conflict). Static, read-only: no DB read, no SQL, no AI
// call and no network. Email and phone are user-initiated OS handoffs only.
//
// FR-19.3 / restructuring brief D-5: Send Email and Call Support use the shared
// PeachButton. No raw TouchableOpacity remains for those actions.

const MAX_CONTENT_WIDTH = 640;
const BACK_SIZE = 40;
const HEADER_CHIP_SIZE = 40;
const ICON_CHIP_SIZE = 44;
const BANNER_ICON_SIZE = 28;
const FAQ_NUMBER_SIZE = 20;
// Canonical answer indent is pl-7 (28px): the 20px number circle plus an 8px gap.
const FAQ_ANSWER_INDENT = FAQ_NUMBER_SIZE + Spacing.s2;
const CONTROL_HIT_SLOP = { top: 2, bottom: 2, left: 2, right: 2 };
// Decorative header-chip glyph tint (canonical text-purple-200).
const HEADER_CHIP_ICON_COLOR = '#E9D5FF';

// 160deg CSS gradient expressed as unit start/end points, matching PeachButton.
const GRADIENT_START = { x: 0.33, y: 0 };
const GRADIENT_END = { x: 0.67, y: 1 };

// Real v1 support contact and response-time copy (docs/audit-v2.md:627-630).
// Unchanged from v1 per FR-19.1/FR-19.2. No placeholder or fabricated value.
const SUPPORT_EMAIL = 'kingonuoha01@gmail.com';
const SUPPORT_PHONE_DIAL = '+2349076589170';
const SUPPORT_PHONE_DISPLAY = '+234 907 658 9170';
const RESPONSE_TIME = 'Response within 24 hours on weekdays';

interface FaqEntry {
  id: number;
  question: string;
  answer: string;
}

// The four v1 FAQ items, unchanged per FR-19.2. Rendered as always-open
// scannable cards; no accordion, so no collapsed state exists.
const FAQS: FaqEntry[] = [
  {
    id: 1,
    question: 'How do I scan a receipt?',
    answer:
      'Tap the Scan tab in the bottom nav, align your receipt within the frame, and tap the capture button. The AI will extract line items for review.',
  },
  {
    id: 2,
    question: 'Is my data stored online?',
    answer:
      'No. All your expense data is stored locally on your device. Receipt images are sent to the AI provider you configure for processing only when you scan.',
  },
  {
    id: 3,
    question: 'How do I export my expenses?',
    answer:
      'Export lives in Settings. You can export your categorized entries to CSV and keep a copy on your device.',
  },
  {
    id: 4,
    question: 'Can I use multiple currencies?',
    answer:
      'Yes. Set your preferred currency in Settings. You can also convert existing entries through the shared currency conversion flow.',
  },
];

export default function SupportCenterScreen() {
  const ts = useThemeStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const appVersion = Constants.expoConfig?.version;

  const gradient = ts.isDark ? Gradients.dark : Gradients.light;
  const cardVariant = ts.isDark ? 'low' : 'high';
  const emailTint = ts.isDark ? CategoryTints.entertainment.dark : CategoryTints.entertainment.light;
  const phoneTint = ts.isDark ? CategoryTints.groceries.dark : CategoryTints.groceries.light;

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/settings');
  }, [router]);

  // One honest external-intent boundary for both actions. If the OS has no
  // handler for mailto/tel the URL rejects, so the value is copied to the
  // clipboard and the unavailable-link error is surfaced through the app toast.
  const openExternal = useCallback(
    async (url: string, fallbackValue: string, unavailableCopy: string) => {
      if (busy) return;
      setBusy(true);
      try {
        await Linking.openURL(url);
      } catch {
        await Clipboard.setStringAsync(fallbackValue);
        showToast(unavailableCopy, 'error');
      } finally {
        setBusy(false);
      }
    },
    [busy, showToast],
  );

  const handleEmail = useCallback(() => {
    void openExternal(
      `mailto:${SUPPORT_EMAIL}`,
      SUPPORT_EMAIL,
      `No mail app available. ${SUPPORT_EMAIL} copied to the clipboard.`,
    );
  }, [openExternal]);

  const handlePhone = useCallback(() => {
    void openExternal(
      `tel:${SUPPORT_PHONE_DIAL}`,
      SUPPORT_PHONE_DISPLAY,
      `No phone app available. ${SUPPORT_PHONE_DISPLAY} copied to the clipboard.`,
    );
  }, [openExternal]);

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: gradient[0] }]} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />

      <LinearGradient
        colors={gradient}
        start={GRADIENT_START}
        end={GRADIENT_END}
        style={styles.header}
      >
        <View style={styles.headerRow}>
          <ScalePressable
            onPress={goBack}
            accessibilityRole="button"
            accessibilityLabel="Back to Settings"
            hitSlop={CONTROL_HIT_SLOP}
            style={styles.backControl}
          >
            <ArrowLeft size={20} color={Colors.white} strokeWidth={2.5} />
          </ScalePressable>

          <View style={styles.headerTitleBlock}>
            <Text style={[Typography.micro, styles.headerOverline]} numberOfLines={1}>
              Help &amp; Inquiries
            </Text>
            <Text
              style={[Typography.headlineMd, styles.headerTitle]}
              numberOfLines={1}
              accessibilityRole="header"
            >
              Support Center
            </Text>
          </View>

          <View
            style={styles.headerChip}
            accessible={false}
            importantForAccessibility="no-hide-descendants"
          >
            <LifeBuoy size={18} color={HEADER_CHIP_ICON_COLOR} />
          </View>
        </View>

        <View style={styles.trustBadge}>
          <View style={styles.trustLeft}>
            <View
              style={styles.trustDot}
              accessible={false}
              importantForAccessibility="no-hide-descendants"
            />
            <Text style={[Typography.micro, styles.trustText]}>Support Team Active</Text>
          </View>
          <Text style={[Typography.micro, styles.trustTime]}>Typical reply within 24 hours</Text>
        </View>
      </LinearGradient>

      <View style={[styles.body, { backgroundColor: ts.bg.screen }]}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.content, { paddingBottom: Spacing.s8 + insets.bottom }]}
        >
          <LuminousCard
            variant={cardVariant}
            style={[styles.banner, { backgroundColor: ts.raw.purple100, borderColor: ts.raw.primary + '33' }]}
          >
            <View style={styles.bannerRow}>
              <View
                style={[styles.bannerIcon, { backgroundColor: ts.raw.primary }]}
                accessible={false}
                importantForAccessibility="no-hide-descendants"
              >
                <Info size={16} color={Colors.white} strokeWidth={2} />
              </View>
              <View style={styles.bannerText}>
                <Text style={[Typography.labelBold, { color: ts.raw.onSurface }]}>
                  How can we assist you today?
                </Text>
                <Text style={[Typography.micro, styles.bannerBody, { color: ts.raw.onSurfaceVariant }]}>
                  Reach our real humans via direct email or call, or glance through the four
                  answers below for immediate clarity.
                </Text>
              </View>
            </View>
          </LuminousCard>

          <View style={styles.sectionHeader}>
            <Text style={[Typography.micro, styles.sectionTitle, { color: ts.raw.onSurfaceVariant }]}>
              Direct Assistance
            </Text>
          </View>

          <LuminousCard
            variant={cardVariant}
            style={[styles.card, !ts.isDark ? styles.cardShadow : null]}
          >
            <View style={styles.cardHeader}>
              <View
                style={[styles.iconChip, { backgroundColor: emailTint[0] }]}
                accessible={false}
                importantForAccessibility="no-hide-descendants"
              >
                <Mail size={24} color={emailTint[1]} strokeWidth={2} />
              </View>
              <View style={styles.cardText}>
                <Text style={[Typography.micro, styles.cardLabel, { color: emailTint[1] }]}>
                  Written Support
                </Text>
                <Text style={[Typography.labelBold, { color: ts.raw.onSurface }]} numberOfLines={1}>
                  {SUPPORT_EMAIL}
                </Text>
                <Text
                  style={[Typography.labelMd, styles.cardMeta, { color: ts.raw.onSurfaceVariant }]}
                  numberOfLines={2}
                >
                  {RESPONSE_TIME}
                </Text>
              </View>
            </View>

            <View style={[styles.cardFooter, { borderTopColor: ts.raw.outline }]}>
              <Text style={[Typography.micro, styles.helper, { color: ts.raw.onSurfaceVariant }]}>
                Launches default mail app
              </Text>
              <PeachButton
                title="Send Email"
                onPress={handleEmail}
                variant="primary"
                size="sm"
                disabled={busy}
                accessibilityLabel={`Send email to ${SUPPORT_EMAIL}`}
                icon={<Send size={14} color={Colors.white} strokeWidth={2} />}
              />
            </View>
          </LuminousCard>

          <LuminousCard
            variant={cardVariant}
            style={[styles.card, !ts.isDark ? styles.cardShadow : null]}
          >
            <View style={styles.cardHeader}>
              <View
                style={[styles.iconChip, { backgroundColor: phoneTint[0] }]}
                accessible={false}
                importantForAccessibility="no-hide-descendants"
              >
                <Phone size={24} color={phoneTint[1]} strokeWidth={2} />
              </View>
              <View style={styles.cardText}>
                <Text style={[Typography.micro, styles.cardLabel, { color: phoneTint[1] }]}>
                  Direct Phone Support
                </Text>
                <Text style={[Typography.labelBold, { color: ts.raw.onSurface }]} numberOfLines={1}>
                  {SUPPORT_PHONE_DISPLAY}
                </Text>
                <Text
                  style={[Typography.labelMd, styles.cardMeta, { color: ts.raw.onSurfaceVariant }]}
                  numberOfLines={2}
                >
                  {RESPONSE_TIME}
                </Text>
              </View>
            </View>

            <View style={[styles.cardFooter, { borderTopColor: ts.raw.outline }]}>
              <Text style={[Typography.micro, styles.helper, { color: ts.raw.onSurfaceVariant }]}>
                Initiates phone dialer
              </Text>
              <PeachButton
                title="Call Support"
                onPress={handlePhone}
                variant="secondary"
                size="sm"
                disabled={busy}
                accessibilityLabel={`Call support at ${SUPPORT_PHONE_DISPLAY}`}
                icon={<Phone size={14} color={ts.raw.primary} strokeWidth={2} />}
              />
            </View>
          </LuminousCard>

          <View style={styles.sectionHeader}>
            <View style={styles.sectionHeaderText}>
              <Text
                style={[Typography.micro, styles.sectionTitle, { color: ts.raw.onSurfaceVariant }]}
              >
                Frequently Asked Questions
              </Text>
              <Text style={[Typography.micro, { color: ts.raw.onSurfaceVariant }]}>
                Static scannable answers, no accordion hide or seek
              </Text>
            </View>
            <View
              style={[styles.countPill, { backgroundColor: ts.bg.elevated, borderColor: ts.raw.outline }]}
              accessible={false}
              importantForAccessibility="no-hide-descendants"
            >
              <Text style={[Typography.micro, styles.countText, { color: ts.raw.onSurfaceVariant }]}>
                {FAQS.length} of {FAQS.length}
              </Text>
            </View>
          </View>

          {FAQS.map((faq) => (
            <LuminousCard
              key={faq.id}
              variant={cardVariant}
              style={[styles.faq, !ts.isDark ? styles.cardShadow : null]}
            >
              <View style={styles.faqQuestionRow}>
                <View
                  style={[styles.faqNumber, { backgroundColor: ts.raw.purple100 }]}
                  accessible={false}
                  importantForAccessibility="no-hide-descendants"
                >
                  <Text style={[Typography.micro, styles.faqNumberText, { color: ts.raw.primary }]}>
                    {faq.id}
                  </Text>
                </View>
                <Text
                  accessibilityRole="header"
                  style={[Typography.labelBold, styles.faqQuestion, { color: ts.raw.onSurface }]}
                >
                  {faq.question}
                </Text>
              </View>
              <Text
                style={[
                  Typography.labelMd,
                  styles.faqAnswer,
                  { color: ts.raw.onSurfaceVariant, paddingLeft: FAQ_ANSWER_INDENT },
                ]}
              >
                {faq.answer}
              </Text>
            </LuminousCard>
          ))}

          <View style={styles.footer}>
            {appVersion ? (
              <Text style={[Typography.micro, { color: ts.raw.onSurfaceVariant }]}>
                PeachSpend version {appVersion}
              </Text>
            ) : null}
            <Text
              style={[Typography.micro, styles.footerSub, { color: ts.raw.onSurfaceVariant }]}
            >
              Your ledger stays on this device.
            </Text>
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    paddingHorizontal: Spacing.s5,
    paddingTop: Spacing.s3,
    paddingBottom: Spacing.s5,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s3,
    marginBottom: Spacing.s3,
  },
  backControl: {
    width: BACK_SIZE,
    height: BACK_SIZE,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  headerTitleBlock: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
  },
  headerOverline: {
    fontFamily: 'Manrope_600SemiBold',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: '#E9D5FF',
  },
  headerTitle: {
    color: Colors.white,
  },
  headerChip: {
    width: HEADER_CHIP_SIZE,
    height: HEADER_CHIP_SIZE,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  trustBadge: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: Spacing.s3,
    rowGap: Spacing.s1,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    borderRadius: Radii.md,
    paddingHorizontal: Spacing.s3,
    paddingVertical: Spacing.s2,
  },
  trustLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.s2,
    flexShrink: 1,
  },
  trustDot: {
    width: 8,
    height: 8,
    borderRadius: Radii.full,
    backgroundColor: '#34D399',
  },
  trustText: {
    color: 'rgba(255,255,255,0.9)',
    fontFamily: 'Manrope_500Medium',
  },
  trustTime: {
    // Canonical text-purple-200 (#E9D5FF), the same tone as the header overline.
    color: HEADER_CHIP_ICON_COLOR,
    fontFamily: 'Manrope_600SemiBold',
  },
  body: {
    flex: 1,
  },
  content: {
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: 'center',
    paddingHorizontal: Spacing.s5,
    paddingTop: Spacing.s4,
    gap: Spacing.s4,
  },
  banner: {
    borderRadius: Radii.md,
    padding: Spacing.s3,
  },
  bannerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.s3,
  },
  bannerIcon: {
    width: BANNER_ICON_SIZE,
    height: BANNER_ICON_SIZE,
    borderRadius: Radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerText: {
    flex: 1,
    minWidth: 0,
  },
  bannerBody: {
    marginTop: 2,
    lineHeight: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: Spacing.s3,
    marginTop: Spacing.s1,
  },
  sectionHeaderText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  sectionTitle: {
    fontFamily: 'Manrope_700Bold',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  countPill: {
    borderRadius: Radii.sm,
    borderWidth: 1,
    paddingHorizontal: Spacing.s2,
    paddingVertical: 2,
  },
  countText: {
    fontFamily: 'Manrope_700Bold',
  },
  card: {
    borderRadius: Radii.lg,
    padding: Spacing.s4,
  },
  cardShadow: {
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.s3,
  },
  iconChip: {
    width: ICON_CHIP_SIZE,
    height: ICON_CHIP_SIZE,
    borderRadius: Radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  cardText: {
    flex: 1,
    minWidth: 0,
  },
  cardLabel: {
    fontFamily: 'Manrope_600SemiBold',
    letterSpacing: 0.2,
  },
  cardMeta: {
    marginTop: Spacing.s1,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.s3,
    marginTop: Spacing.s3,
    paddingTop: Spacing.s3,
    borderTopWidth: 1,
  },
  helper: {
    flex: 1,
    minWidth: 0,
    flexShrink: 1,
  },
  faq: {
    borderRadius: Radii.lg,
    padding: Spacing.s4,
  },
  faqQuestionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.s2,
    marginBottom: Spacing.s2,
  },
  faqNumber: {
    width: FAQ_NUMBER_SIZE,
    height: FAQ_NUMBER_SIZE,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  faqNumberText: {
    fontFamily: 'Manrope_700Bold',
  },
  faqQuestion: {
    flex: 1,
    minWidth: 0,
  },
  faqAnswer: {
    lineHeight: 18,
  },
  footer: {
    alignItems: 'center',
    gap: Spacing.s1,
    marginTop: Spacing.s2,
  },
  footerSub: {
    textAlign: 'center',
  },
});
