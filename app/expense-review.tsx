import React, { useState } from 'react';
import { View, Text, ScrollView, TextInput, KeyboardAvoidingView, Platform, TouchableOpacity } from 'react-native';

import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Tag, DollarSign, Store, Check, X } from 'lucide-react-native';
import { databaseService } from '../services/DatabaseService';
import { Strings } from '../constants/strings';
import { Colors } from '../constants/tokens';
import { LuminousCard } from '../components/ui/LuminousCard';
import { PeachButton } from '../components/ui/PeachButton';
import { logger } from '../utils/logger';
import { useThemeStyles } from '../hooks/useThemeStyles';
import { ScannedReceipt } from '../types/gemini';

type ReviewData = Partial<Pick<ScannedReceipt, 'merchant' | 'currency' | 'category' | 'note'>> & {
  amount?: number | string;
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null
);

const parseReviewData = (value: string | undefined): ReviewData | null => {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed)) return null;
    return {
      merchant: typeof parsed.merchant === 'string' ? parsed.merchant : undefined,
      amount: typeof parsed.amount === 'number' || typeof parsed.amount === 'string' ? parsed.amount : undefined,
      currency: typeof parsed.currency === 'string' ? parsed.currency : undefined,
      category: typeof parsed.category === 'string' ? parsed.category : undefined,
      note: typeof parsed.note === 'string' ? parsed.note : undefined,
    };
  } catch {
    return null;
  }
};

const getMissingFields = (value: ReviewData | null): string[] => {
  if (!value) return ['receipt data'];
  const missing: string[] = [];
  if (!value.merchant?.trim()) missing.push('merchant');
  if (value.amount === undefined || value.amount === '' || !Number.isFinite(Number(value.amount)) || Number(value.amount) <= 0) missing.push('amount');
  if (!value.currency?.trim()) missing.push('currency');
  if (!value.category?.trim()) missing.push('category');
  return missing;
};

export default function ExpenseReviewScreen() {
  const ts = useThemeStyles();
  const { data } = useLocalSearchParams<{ data: string }>();
  const router = useRouter();
  const parsedData = parseReviewData(data);
  const missingFields = getMissingFields(parsedData);

  const [merchant, setMerchant] = useState(parsedData?.merchant || '');
  const [amount, setAmount] = useState(parsedData?.amount?.toString() || '');
  const [category, setCategory] = useState(parsedData?.category || '');
  const [currency] = useState(parsedData?.currency || '');
  const [note] = useState(parsedData?.note || '');
  const [validationError, setValidationError] = useState<string | null>(
    missingFields.length > 0 ? `Missing required receipt data: ${missingFields.join(', ')}` : null
  );

  const handleSave = async () => {
    const numericAmount = Number(amount);
    if (!merchant.trim() || !currency.trim() || !category.trim() || !Number.isFinite(numericAmount) || numericAmount <= 0) {
      setValidationError('Enter merchant, amount, currency, and category before saving.');
      return;
    }
    try {
      const now = Date.now();
      const repository = await databaseService.getCaptureRepository();
      await repository.save({
        merchant,
        amount: numericAmount,
        currency,
        category,
        note,
        scanned: true,
        date: now,
        source: 'ocr',
      });
      router.dismissAll();
      router.replace('/(tabs)');
    } catch {
      logger.error('Failed to save expense', 'expense_review_save_failed');
    }
  };

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: ts.bg.screen }} edges={['bottom']}>
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1"
      >
        <ScrollView className="flex-1 px-6">
          <View className="flex-row justify-between items-center py-6">
            <View>
              <Text className="text-white text-3xl font-manrope-bold">
                {Strings.review.title}
              </Text>
              <Text className="text-textSecondary font-manrope-medium mt-1">
                {Strings.review.subtitle}
              </Text>
            </View>
            <TouchableOpacity 
              onPress={() => router.back()}
              className="p-2 rounded-full"
              style={{ backgroundColor: ts.bg.card }}
            >
              <X color={Colors.textSecondary} size={24} />
            </TouchableOpacity>
          </View>

          <LuminousCard className="mb-6 p-6">
            {validationError && (
              <Text className="text-red-400 font-manrope-medium mb-5">{validationError}</Text>
            )}
            {/* Merchant Input */}
            <View className="mb-6">
              <View className="flex-row items-center mb-2">
                <Store size={18} color={Colors.primary} />
                <Text className="text-textSecondary font-manrope-semibold ml-2 uppercase text-xs tracking-widest">
                  {Strings.review.merchant}
                </Text>
              </View>
              <TextInput
                value={merchant}
                onChangeText={setMerchant}
                placeholder="Where did you spend?"
                placeholderTextColor={Colors.textTertiary}
                className="text-white text-lg font-manrope-medium border-b pb-2"
                style={{ borderColor: ts.border.subtle }}
              />
            </View>

            {/* Amount Input */}
            <View className="mb-6">
              <View className="flex-row items-center mb-2">
                <DollarSign size={18} color={Colors.primary} />
                <Text className="text-textSecondary font-manrope-semibold ml-2 uppercase text-xs tracking-widest">
                  {Strings.review.amount}
                </Text>
              </View>
              <TextInput
                value={amount}
                onChangeText={setAmount}
                keyboardType="numeric"
                placeholder="Enter amount"
                placeholderTextColor={Colors.textTertiary}
                className="text-white text-3xl font-manrope-bold border-b border-surfaceContainerHigh pb-2"
              />
            </View>

            {/* Category Input */}
            <View className="mb-2">
              <View className="flex-row items-center mb-2">
                <Tag size={18} color={Colors.primary} />
                <Text className="text-textSecondary font-manrope-semibold ml-2 uppercase text-xs tracking-widest">
                  {Strings.review.category}
                </Text>
              </View>
              <TextInput
                value={category}
                onChangeText={setCategory}
                placeholder="Select category"
                placeholderTextColor={Colors.textTertiary}
                className="text-white text-lg font-manrope-medium border-b border-surfaceContainerHigh pb-2"
              />
            </View>
          </LuminousCard>

          <PeachButton 
            title={Strings.review.save}
            onPress={handleSave}
            icon={<Check size={20} color="black" />}
            className="mb-10"
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
