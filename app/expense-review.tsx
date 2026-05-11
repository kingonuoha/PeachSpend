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
import { v4 as uuidv4 } from 'uuid';
import { useThemeStyles } from '../hooks/useThemeStyles';

export default function ExpenseReviewScreen() {
  const ts = useThemeStyles();
  const { data } = useLocalSearchParams<{ data: string }>();
  const router = useRouter();
  const parsedData = data ? JSON.parse(data) : {};

  const [merchant, setMerchant] = useState(parsedData.merchant || '');
  const [amount, setAmount] = useState(parsedData.amount?.toString() || '');
  const [category, setCategory] = useState(parsedData.category || 'other');
  const [currency] = useState(parsedData.currency || 'USD');
  const [note] = useState(parsedData.note || '');

  const handleSave = async () => {
    try {
      const now = Date.now();
      await databaseService.addExpense({
        id: uuidv4(),
        merchant,
        amount: parseFloat(amount) || 0,
        currency,
        category,
        note,
        scanned: 1,
        date: now,
        created_at: now
      });
      router.dismissAll();
      router.replace('/(tabs)');
    } catch (error) {
      logger.error('Failed to save expense', error);
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
                placeholder="0.00"
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

