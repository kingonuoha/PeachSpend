import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemeStyles } from '../hooks/useThemeStyles';
import { CategoryTints, Spacing, Typography } from '../constants/tokens';
import { PeachButton } from '../components/ui/PeachButton';
import { DuplicateWarningModal } from '../components/expense/DuplicateWarningModal';
import { VerificationSheet } from '../components/expense/VerificationSheet';
import { AIProcessingOverlayShowcase, CardsShowcase, CategoryPickerShowcase, CurrencyPickersShowcase, SearchFilterBarShowcase, ShowcaseCard, TabBarShowcase, VirtualNumpadShowcase, ButtonsShowcase } from '../components/showcase/ShowcaseComponents';
import { type CaptureCategory } from '../components/capture/CategoryPickerSheet';
import { PickerSheetItem } from '../components/ui/LuminousCard';
import { TrainFront, UtensilsCrossed } from 'lucide-react-native';
import { Expense } from '../types/database';
import { ScannedReceipt } from '../types/gemini';

// Dev-only fixtures. The picker component renders no fixed category, amount or tint.
const previewCategories: CaptureCategory[] = [
  { id: 'dining', title: 'Dining', icon_name: 'utensils', meta: '412.50' },
  { id: 'groceries', title: 'Groceries', icon_name: 'shopping-cart', meta: '386.00' },
  { id: 'transport', title: 'Transport', icon_name: 'car', meta: '184.00' },
  { id: 'utilities', title: 'Utilities', icon_name: 'zap', meta: '240.10' },
  { id: 'shopping', title: 'Shopping', icon_name: 'shopping-bag', meta: '321.00' },
  { id: 'entertainment', title: 'Fun', icon_name: 'film', meta: '115.00' },
  { id: 'health', title: 'Health', icon_name: 'heart', meta: '95.00' },
];
export default function ComponentShowcase() {
  const ts = useThemeStyles();
  const insets = useSafeAreaInsets();
  const [category, setCategory] = useState('dining');
  const [currency] = useState('NGN');
  const [amount] = useState('64.2');
  const [activeTab, setActiveTab] = useState('home');
  const [isVerificationVisible, setVerificationVisible] = useState(false);
  const [isDuplicateVisible, setDuplicateVisible] = useState(false);
  const [lastAction, setLastAction] = useState('');
  const [cardCategory, setCardCategory] = useState('dining');
  const [previewTimestamp] = useState(() => Date.now());

  // Dev-only card fixtures. The card components render nothing fixed; production
  // callers pass formatted amounts, category names and tint pairs from the data layer.
  const statFixture = {
    label: 'March 2025 · Spent So Far',
    badge: '14 days left',
    amount: '1,842.50',
    insightTitle: 'Safe-to-spend: 58.30/day',
    insightBody: '18% less than your typical pace',
  };
  const textFixtureBody = (
    <Text style={[Typography.bodyRegular, { color: ts.text.onSurface }]}>
      You logged some transactions over the weekend totaling{' '}
      <Text style={[Typography.bodyRegular, { color: ts.text.primary, fontFamily: 'Manrope_700Bold' }]}>
        142.30
      </Text>
      . Coffee runs were down compared to last weekend, keeping your dining budget on track.
    </Text>
  );
  const cardItems: PickerSheetItem[] = [
    {
      id: 'dining',
      name: 'Dining & Food',
      description: 'Restaurants, takeout, drinks',
      tint: ts.isDark ? CategoryTints.dining.dark[0] : CategoryTints.dining.light[0],
      iconColor: ts.isDark ? CategoryTints.dining.dark[1] : CategoryTints.dining.light[1],
      icon: (color) => <UtensilsCrossed size={16} color={color} strokeWidth={2.2} />,
    },
    {
      id: 'transport',
      name: 'Transport & Transit',
      description: 'Subway, bus, ride shares',
      meta: '184.00',
      tint: ts.isDark ? CategoryTints.transport.dark[0] : CategoryTints.transport.light[0],
      iconColor: ts.isDark ? CategoryTints.transport.dark[1] : CategoryTints.transport.light[1],
      icon: (color) => <TrainFront size={16} color={color} strokeWidth={2.2} />,
    },
  ];

  const verificationData: ScannedReceipt[] = [{
    merchant: 'Preview merchant',
    amount: Number(amount) || 0,
    category,
    currency,
    confidence: 1,
    note: 'Preview item',
  }];
  const existingExpense: Expense = {
    id: 'showcase-expense',
    merchant: 'Preview merchant',
    amount: Number(amount) || 0,
    currency,
    category,
    scanned: 1,
    date: previewTimestamp,
    created_at: previewTimestamp,
  };

  if (!__DEV__) {
    return <Redirect href="/(tabs)" />;
  }

  return <View style={[styles.screen, { backgroundColor: ts.bg.screen }]}><ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + Spacing.s5, paddingBottom: insets.bottom + 110 }]}> 
    <Text style={[styles.kicker, { color: ts.text.primary }]}>Reusable component showcase</Text><Text style={[styles.title, { color: ts.text.onSurface }]}>Foundation components</Text><Text style={[styles.subtitle, { color: ts.text.onSurfaceVariant }]}>Phase 01 preview. Components accept live data and callbacks, fixture data stays here.</Text>
     <ShowcaseCard title="Buttons"><ButtonsShowcase onAction={setLastAction} />{lastAction ? <Text style={[styles.note, { color: ts.text.primary }]} accessibilityLiveRegion="polite">{lastAction}</Text> : null}</ShowcaseCard>
     <ShowcaseCard title="Cards"><CardsShowcase stat={statFixture} text={{ title: 'Mindful Weekend Recap', meta: 'Generated by PeachAI · Sunday 8:00 PM', body: textFixtureBody, question: 'Was this reflection helpful?', onAffirm: () => setLastAction('Card reflection marked helpful'), onDismiss: () => setLastAction('Card reflection dismissed') }} picker={{ title: 'Select Category', items: cardItems, selectedId: cardCategory, onSelect: setCardCategory, onClose: () => setLastAction('Category picker closed') }} /></ShowcaseCard>
    <ShowcaseCard title="Category picker"><CategoryPickerShowcase categories={previewCategories} selectedId={category} onSelect={(item) => setCategory(item.id)} onRequestCustom={() => setLastAction('Custom category requested')} />{lastAction === 'Custom category requested' ? <Text style={[styles.note, { color: ts.text.primary }]} accessibilityLiveRegion="polite">Custom category requested</Text> : null}</ShowcaseCard>
    <ShowcaseCard title="Currency pickers"><CurrencyPickersShowcase /></ShowcaseCard>
    <ShowcaseCard title="Virtual numpad"><VirtualNumpadShowcase /></ShowcaseCard>
     <ShowcaseCard title="Search and filter"><SearchFilterBarShowcase /></ShowcaseCard>
     <ShowcaseCard title="AI processing overlay"><AIProcessingOverlayShowcase onAction={setLastAction} />{lastAction === 'Processing cancelled' ? <Text style={[styles.note, { color: ts.text.primary }]} accessibilityLiveRegion="polite">Processing cancelled</Text> : null}</ShowcaseCard>
     <ShowcaseCard title="Verification and duplicate states"><View style={styles.stack}><PeachButton title="Open verification sheet" onPress={() => setVerificationVisible(true)} /><PeachButton title="Open duplicate warning" variant="secondary" onPress={() => setDuplicateVisible(true)} /></View><Text style={[styles.note, { color: ts.text.onSurfaceVariant }]}>Production components open above with showcase fixture data.</Text></ShowcaseCard>
     <ShowcaseCard title="NS-02 tab bar, light and dark token aware"><TabBarShowcase active={activeTab} onSelect={setActiveTab} onAdd={() => setLastAction('Log transaction control pressed')} onAction={setLastAction} />{lastAction === 'Log transaction control pressed' ? <Text style={[styles.note, { color: ts.text.primary }]} accessibilityLiveRegion="polite">Log transaction control pressed</Text> : null}</ShowcaseCard>
    </ScrollView><VerificationSheet isVisible={isVerificationVisible} data={verificationData} onConfirm={() => setVerificationVisible(false)} onCancel={() => setVerificationVisible(false)} />{isDuplicateVisible ? <DuplicateWarningModal visible duplicate={{ existing: existingExpense, reason: 'merchant_amount_24h' }} incoming={{ merchant: existingExpense.merchant, amount: existingExpense.amount, currency: existingExpense.currency, category: existingExpense.category, type: 'expense', date: previewTimestamp }} onSaveAnyway={() => setDuplicateVisible(false)} onDiscard={() => setDuplicateVisible(false)} /> : null}</View>;
}

  const styles = StyleSheet.create({ screen: { flex: 1 }, content: { paddingHorizontal: Spacing.s5 }, kicker: { ...Typography.labelMd, fontWeight: '700', marginBottom: Spacing.s1 }, title: { ...Typography.displayMd }, subtitle: { ...Typography.bodyMd, marginTop: Spacing.s2, marginBottom: Spacing.s6 }, stack: { gap: Spacing.s3 }, note: { ...Typography.bodyMd } });
