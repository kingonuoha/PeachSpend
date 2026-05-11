import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, Linking, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, Mail, Phone, HelpCircle, MessageCircle, FileText } from 'lucide-react-native';
import { useThemeStyles } from '../hooks/useThemeStyles';
import { Colors } from '../constants/tokens';
import { LuminousCard } from '../components/ui/LuminousCard';

const SUPPORT_EMAIL = 'kingonuoha01@gmail.com';
const SUPPORT_PHONE = '+2349076589170';

export default function SupportCenterScreen() {
  const styles = useThemeStyles();
  const router = useRouter();

  const handleEmail = () => {
    Linking.openURL(`mailto:${SUPPORT_EMAIL}`).catch(() => {
      Alert.alert('Error', 'Could not open email client');
    });
  };

  const handlePhone = () => {
    Linking.openURL(`tel:${SUPPORT_PHONE}`).catch(() => {
      Alert.alert('Error', 'Could not open phone dialer');
    });
  };

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
        <Text style={{ color: styles.text.onSurface }} className="font-noto-serif-bold text-2xl ml-4">Support Center</Text>
      </View>

      <ScrollView className="flex-1 px-6" contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <View className="items-center mb-8">
          <View className="w-20 h-20 rounded-[30px] bg-primary/10 items-center justify-center mb-4">
            <HelpCircle size={40} color={Colors.primary} />
          </View>
          <Text style={{ color: styles.text.onSurface }} className="font-noto-serif-bold text-xl">We're Here to Help</Text>
          <Text style={{ color: styles.text.onSurfaceVariant60 }} className="font-manrope-regular text-sm text-center mt-2 leading-6">
            Reach out via email or phone for prompt assistance with any issues or inquiries.
          </Text>
        </View>

        <LuminousCard className="p-6 mb-6" style={{ borderColor: styles.border.subtle, borderWidth: 1 }}>
          <TouchableOpacity onPress={handleEmail} className="flex-row items-center py-4" activeOpacity={0.7}>
            <View className="w-12 h-12 rounded-2xl bg-primary/10 items-center justify-center">
              <Mail size={22} color={Colors.primary} />
            </View>
            <View className="ml-4 flex-1">
              <Text style={{ color: styles.text.onSurface }} className="font-manrope-bold text-base">Email</Text>
              <Text style={{ color: styles.text.onSurfaceVariant60 }} className="font-manrope-medium text-sm mt-0.5">{SUPPORT_EMAIL}</Text>
            </View>
            <Text className="text-primary font-manrope-bold text-xs uppercase tracking-widest">Send</Text>
          </TouchableOpacity>

          <View style={{ borderBottomColor: styles.border.subtle, borderBottomWidth: 1 }} />

          <TouchableOpacity onPress={handlePhone} className="flex-row items-center py-4" activeOpacity={0.7}>
            <View className="w-12 h-12 rounded-2xl bg-primary/10 items-center justify-center">
              <Phone size={22} color={Colors.primary} />
            </View>
            <View className="ml-4 flex-1">
              <Text style={{ color: styles.text.onSurface }} className="font-manrope-bold text-base">Phone</Text>
              <Text style={{ color: styles.text.onSurfaceVariant60 }} className="font-manrope-medium text-sm mt-0.5">{SUPPORT_PHONE}</Text>
            </View>
            <Text className="text-primary font-manrope-bold text-xs uppercase tracking-widest">Call</Text>
          </TouchableOpacity>
        </LuminousCard>

        <LuminousCard className="p-6 mb-6" style={{ borderColor: styles.border.subtle, borderWidth: 1 }}>
          <Text style={{ color: styles.text.onSurface }} className="font-manrope-bold text-lg mb-4">Frequently Asked Questions</Text>

          <FaqItem
            question="How do I scan a receipt?"
            answer="Tap the Scan tab in the bottom nav, align your receipt within the frame, and tap the capture button. The AI will extract line items for review."
            styles={styles}
          />
          <FaqItem
            question="Is my data stored online?"
            answer="No. All your expense data is stored locally on your device. Receipt images are sent to Google Gemini AI for processing only when you scan."
            styles={styles}
          />
          <FaqItem
            question="How do I export my expenses?"
            answer="Export functionality is available in the analytics page. You can view all-time spending and filter by date range."
            styles={styles}
          />
          <FaqItem
            question="Can I use multiple currencies?"
            answer="Yes. Set your preferred currency in Settings. Conversion rates are pre-populated and can be adjusted manually."
            styles={styles}
          />
        </LuminousCard>

        <View className="items-center py-4">
          <Text style={{ color: styles.text.onSurfaceVariant40 }} className="text-xs font-manrope-medium text-center leading-5">
            Response time: Within 24 hours on weekdays
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function FaqItem({ question, answer, styles }: { question: string; answer: string; styles: any }) {
  return (
    <View className="mb-5">
      <Text style={{ color: styles.text.onSurface }} className="font-manrope-semibold text-sm mb-1">{question}</Text>
      <Text style={{ color: styles.text.onSurfaceVariant60 }} className="font-manrope-regular text-xs leading-5">{answer}</Text>
    </View>
  );
}
