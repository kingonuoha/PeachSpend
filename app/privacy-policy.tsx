import React from 'react';
import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { ArrowLeft, ShieldCheck } from 'lucide-react-native';
import { useThemeStyles } from '../hooks/useThemeStyles';
import { Colors } from '../constants/tokens';

export default function PrivacyPolicyScreen() {
  const styles = useThemeStyles();
  const router = useRouter();

  return (
    <SafeAreaView style={{ backgroundColor: styles.bg.screen, flex: 1 }} edges={['top', 'bottom']}>
      <View className="px-6 pt-6 pb-4 flex-row items-center">
        <TouchableOpacity
          onPress={() => router.back()}
          className="p-2 rounded-full"
          style={{ backgroundColor: styles.bg.white5 }}
        >
          <ArrowLeft size={22} color={styles.icon.default} />
        </TouchableOpacity>
        <Text style={{ color: styles.text.onSurface }} className="font-noto-serif-bold text-2xl ml-4">Privacy Policy</Text>
      </View>

      <ScrollView className="flex-1 px-6" contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <View className="items-center mb-8">
          <View className="w-20 h-20 rounded-[30px] bg-primary/10 items-center justify-center mb-4">
            <ShieldCheck size={40} color={Colors.primary} />
          </View>
          <Text style={{ color: styles.text.onSurface }} className="font-noto-serif-bold text-xl">Your Data, Your Control</Text>
        </View>

        <Section title="Information We Collect" styles={styles}>
          We collect minimal data required to provide expense tracking: transaction details you enter (amounts, merchants, categories), scanned receipt images (processed locally via AI), and app preferences (theme, currency). We do not collect location data, contacts, or personal identifiers beyond your chosen profile name.
        </Section>

        <Section title="How We Use Your Data" styles={styles}>
          Your data is used exclusively to power the app's features — categorizing expenses, generating insights, and improving scan accuracy. Receipt images are sent to Google Gemini AI for OCR processing; they are not stored by us beyond your device.
        </Section>

        <Section title="Data Storage" styles={styles}>
          All data is stored locally on your device using SQLite. No data is transmitted to external servers except receipt images sent to Gemini AI for scanning (with your explicit action). You can delete all data at any time via Settings → Data Stewardship.
        </Section>

        <Section title="Third-Party Services" styles={styles}>
          PeachSpend uses Google Gemini API for receipt scanning. Please refer to Google's privacy policy for how they handle image data. No other third-party services access your data.
        </Section>

        <Section title="Your Rights" styles={styles}>
          You have full control over your data. You can export, modify, or permanently delete all data from within the app. No account is required — your data never leaves your device unless you scan a receipt.
        </Section>

        <Section title="Changes to This Policy" styles={styles}>
          We may update this policy as features evolve. Significant changes will be communicated via app notifications. Continued use after changes constitutes acceptance.
        </Section>

        <Text style={{ color: styles.text.onSurfaceVariant40 }} className="text-xs font-manrope-medium text-center mt-8">
          Last updated: May 2026
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, children, styles }: { title: string; children: React.ReactNode; styles: any }) {
  return (
    <View className="mb-6">
      <Text style={{ color: styles.text.onSurface }} className="font-manrope-bold text-base mb-2">{title}</Text>
      <Text style={{ color: styles.text.onSurfaceVariant60 }} className="font-manrope-regular text-sm leading-6">
        {children}
      </Text>
    </View>
  );
}
