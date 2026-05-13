import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, TouchableOpacity, Dimensions, TextInput, Switch, ScrollView } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, withSpring, withSequence } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { X, Delete, Check, Repeat, ArrowDownLeft, ChevronDown } from 'lucide-react-native';
import { Colors } from '../../constants/tokens';
import { useTheme } from '../../components/ui/ThemeProvider';
import { useSettings } from '../../components/ui/SettingsProvider';
import { LuminousCard } from '../../components/ui/LuminousCard';
import { PeachButton } from '../../components/ui/PeachButton';
import { databaseService } from '../../services/DatabaseService';
import { notificationService } from '../../services/NotificationService';
import { logger } from '../../utils/logger';
import { v4 as uuidv4 } from 'uuid';
import * as Haptics from 'expo-haptics';

const { width } = Dimensions.get('window');
const GAP = 12;
const KEY_SIZE = (width - 40 - (GAP * 2)) / 3;

const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'NGN', 'CAD', 'AUD'];

export default function IncomeEntryScreen() {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const { currency, getCurrencySymbol } = useSettings();
  const [amount, setAmount] = useState('0');
  const [source, setSource] = useState('');
  const [note, setNote] = useState('');
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrenceInterval, setRecurrenceInterval] = useState('monthly');
  const [selectedCurrency, setSelectedCurrency] = useState(currency);
  const [showCurrencyPicker, setShowCurrencyPicker] = useState(false);

  const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const [recurrenceDays, setRecurrenceDays] = useState<number[]>([]);

  const fadeAnim = useSharedValue(0);
  const slideAnim = useSharedValue(24);
  const displayScale = useSharedValue(1);

  useEffect(() => {
    fadeAnim.value = withTiming(1, { duration: 400 });
    slideAnim.value = withTiming(0, { duration: 400 });
  }, []);

  const animatePress = useCallback(() => {
    displayScale.value = withSequence(
      withTiming(1.05, { duration: 50 }),
      withSpring(1)
    );
  }, [displayScale]);

  const toggleDay = (day: number) => {
    if (recurrenceDays.includes(day)) {
      setRecurrenceDays(recurrenceDays.filter(d => d !== day));
    } else {
      setRecurrenceDays([...recurrenceDays, day]);
    }
  };

  const handleKeyPress = useCallback((key: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    animatePress();
    setAmount(prev => {
      if (key === 'delete') {
        if (prev.length <= 1) return '0';
        return prev.slice(0, -1);
      }
      if (key === '.') {
        if (prev.includes('.')) return prev;
        return prev + '.';
      }
      if (prev === '0' && key !== '.') return key;
      if (prev.includes('.') && prev.split('.')[1].length >= 2) return prev;
      return prev + key;
    });
  }, [animatePress]);

  const handleSave = async () => {
    if (parseFloat(amount) === 0) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    try {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const now = Date.now();
      const incomeId = uuidv4();

      if (isRecurring) {
        const nextDue = await databaseService.getNextDueDate(recurrenceInterval, recurrenceDays.length > 0 ? JSON.stringify(recurrenceDays) : undefined);
        await databaseService.insertRecurringTemplate({
          id: incomeId,
          merchant: source || 'Income',
          amount: parseFloat(amount),
          currency: selectedCurrency,
          category: 'other',
          note: note || '',
          interval: recurrenceInterval,
          recurrence_days: recurrenceInterval === 'custom' ? JSON.stringify(recurrenceDays) : undefined,
          next_due_date: nextDue,
          type: 'income',
          created_at: now,
        });
      }

      await databaseService.insertIncome({
        id: incomeId,
        source: source || 'Income',
        amount: parseFloat(amount),
        currency: selectedCurrency,
        note: note || '',
        is_recurring: isRecurring ? 1 : 0,
        recurrence_interval: isRecurring ? recurrenceInterval : undefined,
        next_due_date: isRecurring ? (await databaseService.getNextDueDate(recurrenceInterval)).toString() as any : undefined,
        date: now,
        created_at: now,
      });

      notificationService.scheduleExpenseNotification('Income: ' + (source || 'Income'), `${getCurrencySymbol(selectedCurrency)}${parseFloat(amount).toFixed(2)}`);
      router.back();
    } catch (error) {
      logger.error('Failed to save income', error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const Key = ({ value, label, icon: Icon }: { value: string; label?: string; icon?: React.ComponentType<{ size: number; color: string }> }) => (
    <TouchableOpacity
      onPress={() => handleKeyPress(value)}
      activeOpacity={0.7}
      style={{ width: KEY_SIZE, height: KEY_SIZE * 0.7 }}
      className="bg-white/5 rounded-2xl items-center justify-center border border-white/5"
    >
      {Icon ? (
        <Icon size={24} color="white" />
      ) : (
        <Text className="text-white text-2xl font-manrope-bold">{label || value}</Text>
      )}
    </TouchableOpacity>
  );

  const mainStyle = useAnimatedStyle(() => ({
    opacity: fadeAnim.value,
    transform: [{ translateY: slideAnim.value }, { scale: displayScale.value }],
  }));

  const fadeStyle = useAnimatedStyle(() => ({
    opacity: fadeAnim.value,
  }));

  const keypadStyle = useAnimatedStyle(() => ({
    opacity: fadeAnim.value,
    transform: [{ translateY: slideAnim.value }],
    gap: GAP,
  }));

  const saveButtonStyle = useAnimatedStyle(() => ({
    opacity: fadeAnim.value,
    marginTop: 32,
  }));

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: colors.background }}>
      <View className="flex-row justify-between items-center px-6 py-4">
        <TouchableOpacity
          onPress={() => router.back()}
          className="p-2 rounded-full border"
          style={{ backgroundColor: colors.surfaceContainerLow, borderColor: colors.outline + '20' }}
        >
          <X size={20} color={colors.onSurface} />
        </TouchableOpacity>
        <Text style={{ color: colors.onSurface }} className="font-manrope-bold text-lg">Add Income</Text>
        <View className="w-10" />
      </View>

      <View className="flex-1 px-5 pt-4 pb-2">
        <Animated.View style={mainStyle} className="items-center justify-center pt-2 pb-4">
          <View className="w-full mb-6">
            <Text className="text-onSurfaceVariant font-manrope-bold text-[10px] uppercase tracking-[0.2em] mb-2 px-1">
              Income Source
            </Text>
            <TextInput
              className="bg-white/5 border border-white/10 rounded-2xl px-4 py-4 text-white font-manrope-semibold text-lg"
              placeholder="e.g. Salary, Freelance"
              placeholderTextColor="rgba(255,255,255,0.3)"
              value={source}
              onChangeText={setSource}
              selectionColor={Colors.primary}
            />
          </View>

          <Text className="text-onSurfaceVariant font-manrope-bold text-[10px] uppercase tracking-[0.2em] mb-2">
            Amount Received
          </Text>
          <View className="flex-row items-baseline">
            <Text className="text-green-400 font-noto-serif-bold text-3xl mr-2">{getCurrencySymbol(selectedCurrency)}</Text>
            <Text className="text-white font-noto-serif-bold text-7xl tracking-tighter">
              {amount}
            </Text>
          </View>
        </Animated.View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 24 }}
          nestedScrollEnabled
        >
          <Animated.View style={fadeStyle}>
            {/* Note */}
            <TextInput
              className="bg-white/5 border border-white/10 rounded-3xl px-5 py-4 text-white font-manrope-medium text-base mb-3"
              placeholder="Add a note (optional)"
              placeholderTextColor="rgba(255,255,255,0.3)"
              value={note}
              onChangeText={setNote}
              selectionColor={Colors.primary}
            />

            {/* Currency Picker */}
            <TouchableOpacity
              onPress={() => setShowCurrencyPicker(!showCurrencyPicker)}
              style={{ backgroundColor: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1 }}
              className="flex-row items-center justify-between px-5 py-4 rounded-3xl mb-3"
            >
              <View className="flex-row items-center">
                <View className="bg-green-400/10 p-2 rounded-xl mr-3">
                  <ArrowDownLeft size={18} color="#4ADE80" />
                </View>
                <View>
                  <Text className="text-onSurfaceVariant text-[10px] font-manrope-bold uppercase tracking-widest">Currency</Text>
                  <Text className="text-white font-manrope-bold">{selectedCurrency}</Text>
                </View>
              </View>
              <ChevronDown size={18} color="rgba(255,255,255,0.5)" />
            </TouchableOpacity>
            {showCurrencyPicker && (
              <View className="bg-white/10 border border-white/10 rounded-2xl mb-3 overflow-hidden">
                {CURRENCIES.map((c) => (
                  <TouchableOpacity
                    key={c}
                    onPress={() => { setSelectedCurrency(c); setShowCurrencyPicker(false); }}
                    className={`px-5 py-4 ${selectedCurrency === c ? 'bg-green-400/20' : ''}`}
                  >
                    <Text className={`font-manrope-semibold text-base ${selectedCurrency === c ? 'text-green-400' : 'text-white'}`}>{c}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Repeats Toggle */}
            <View style={{ backgroundColor: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1 }} className="flex-row items-center justify-between px-5 py-4 rounded-3xl mb-3">
              <View className="flex-row items-center">
                <View className="bg-primary/10 p-2 rounded-xl mr-3">
                  <Repeat size={18} color={Colors.primary} />
                </View>
                <View>
                  <Text className="text-onSurfaceVariant text-[10px] font-manrope-bold uppercase tracking-widest">Repeats</Text>
                  <Text className="text-white/60 font-manrope-medium text-xs mt-0.5">Recurring income</Text>
                </View>
              </View>
              <Switch
                value={isRecurring}
                onValueChange={setIsRecurring}
                trackColor={{ false: 'rgba(255,255,255,0.1)', true: Colors.primary }}
                thumbColor={isRecurring ? 'white' : '#555'}
              />
            </View>

            {/* Recurring Interval Picker */}
            {isRecurring && (
              <View className="mb-4">
                <View className="flex-row gap-2 mb-3">
                  {['daily', 'weekly', 'monthly', 'custom'].map((interval) => (
                    <TouchableOpacity
                      key={interval}
                      onPress={() => setRecurrenceInterval(interval)}
                      className={`px-4 py-2.5 rounded-xl flex-1 items-center ${recurrenceInterval === interval ? 'bg-primary' : 'bg-white/5 border border-white/10'}`}
                    >
                      <Text className={`font-manrope-bold text-xs uppercase tracking-wider ${recurrenceInterval === interval ? 'text-black' : 'text-white/60'}`}>
                        {interval === 'custom' ? 'Custom' : interval}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {recurrenceInterval === 'custom' && (
                  <View className="flex-row justify-between px-2">
                    {DAY_LETTERS.map((letter, i) => (
                      <TouchableOpacity
                        key={i}
                        onPress={() => toggleDay(i)}
                        style={{
                          backgroundColor: recurrenceDays.includes(i) ? Colors.primary : 'rgba(255,255,255,0.08)',
                          borderColor: recurrenceDays.includes(i) ? Colors.primary : 'rgba(255,255,255,0.1)',
                          borderWidth: 1,
                          width: 40,
                          height: 40,
                          borderRadius: 20,
                        }}
                        className="items-center justify-center"
                      >
                        <Text className={`font-manrope-bold text-sm ${recurrenceDays.includes(i) ? 'text-black' : 'text-white/60'}`}>{letter}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            )}
          </Animated.View>

          <Animated.View style={keypadStyle} className="flex-row flex-wrap justify-between">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'delete'].map((k) => (
              <Key key={k} value={k} label={k === 'delete' ? undefined : k} icon={k === 'delete' ? Delete : undefined} />
            ))}
          </Animated.View>

          <Animated.View style={saveButtonStyle}>
            <PeachButton
              title="Save Income"
              onPress={handleSave}
              icon={<Check size={20} color="black" />}
              className="h-16"
            />
          </Animated.View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}