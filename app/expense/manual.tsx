import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, TouchableOpacity, Dimensions, Modal, ScrollView, TextInput } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, withSpring, withSequence } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  X,
  ChevronRight,
  Delete,
  Check,
  Tag,
  LayoutGrid,
  FileText,
  DollarSign,
  Repeat
} from 'lucide-react-native';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { Switch } from 'react-native';
import { Colors } from '../../constants/tokens';
import { Strings } from '../../constants/strings';
import { useTheme } from '../../components/ui/ThemeProvider';
import { useSettings } from '../../components/ui/SettingsProvider';
import { LuminousCard } from '../../components/ui/LuminousCard';
import { PeachButton } from '../../components/ui/PeachButton';
import { databaseService } from '../../services/DatabaseService';
import { notificationService } from '../../services/NotificationService';
import { logger } from '../../utils/logger';
import { v4 as uuidv4 } from 'uuid';
import { DuplicateWarningModal } from '../../components/expense/DuplicateWarningModal';
import { useAchievements } from '../../components/ui/AchievementProvider';
import { Expense } from '../../types/database';

const { width } = Dimensions.get('window');
const GAP = 12;
const KEY_SIZE = (width - 40 - (GAP * 2)) / 3;

export default function ManualEntryScreen() {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const { currency, getCurrencySymbol } = useSettings();
  const { checkForNewAchievements } = useAchievements();
  const [amount, setAmount] = useState('0');
  const [merchant, setMerchant] = useState('');
  const [selectedCategory, setSelectedCategory] = useState({ id: 'other', title: 'Other' });
  const [categories, setCategories] = useState<{ id: string; title: string; icon_name: string; color: string }[]>([]);
  const [isCategoryModalVisible, setIsCategoryModalVisible] = useState(false);
  const [note, setNote] = useState('');
  const [isReimbursable, setIsReimbursable] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState<Expense | null>(null);
  const [pendingSave, setPendingSave] = useState(false);
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrenceInterval, setRecurrenceInterval] = useState<string>('monthly');
  const [recurrenceDays, setRecurrenceDays] = useState<number[]>([]);

  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  const toggleDay = (day: number) => {
    if (recurrenceDays.includes(day)) {
      setRecurrenceDays(recurrenceDays.filter(d => d !== day));
    } else {
      setRecurrenceDays([...recurrenceDays, day]);
    }
  };

  const fadeAnim = useSharedValue(0);
  const slideAnim = useSharedValue(24);
  const displayScale = useSharedValue(1);

  useEffect(() => {
    const loadCategories = async () => {
      const cats = await databaseService.getCategories();
      setCategories(cats);
      if (cats.length > 0) {
        setSelectedCategory(cats.find(c => c.id === 'other') || cats[0]);
      }
    };
    loadCategories();
    fadeAnim.value = withTiming(1, { duration: 400 });
    slideAnim.value = withTiming(0, { duration: 400 });
  }, []);

  const animatePress = useCallback(() => {
    displayScale.value = withSequence(
      withTiming(1.05, { duration: 50 }),
      withSpring(1)
    );
  }, [displayScale]);

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

  const doSave = async () => {
    const now = Date.now();
    const expenseId = uuidv4();
    
    if (isRecurring) {
      const nextDue = await databaseService.getNextDueDate(recurrenceInterval, recurrenceDays.length > 0 ? JSON.stringify(recurrenceDays) : undefined);
      await databaseService.insertRecurringTemplate({
        id: expenseId,
        merchant: merchant || 'Manual Entry',
        amount: parseFloat(amount),
        currency: currency,
        category: selectedCategory.id,
        note: note || '',
        interval: recurrenceInterval,
        recurrence_days: recurrenceInterval === 'custom' ? JSON.stringify(recurrenceDays) : undefined,
        next_due_date: nextDue,
        type: 'expense',
        created_at: now,
      });
    }

    await databaseService.addExpense({
      id: expenseId,
      merchant: merchant || 'Manual Entry',
      amount: parseFloat(amount),
      currency: currency,
      category: selectedCategory.id,
      note: note,
      scanned: 0,
      date: now,
      created_at: now,
      is_reimbursable: isReimbursable ? 1 : 0,
      is_recurring: isRecurring ? 1 : 0,
      recurrence_parent_id: isRecurring ? expenseId : undefined,
    });
    notificationService.scheduleExpenseNotification(merchant || 'Manual Entry', `${getCurrencySymbol()}${parseFloat(amount).toFixed(2)}`);
    await checkForNewAchievements();
    router.replace('/(tabs)');
  };

  const handleSave = async () => {
    if (parseFloat(amount) === 0) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    try {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const existing = await databaseService.isDuplicate(merchant || 'Manual Entry', parseFloat(amount));
      if (existing) {
        setDuplicateWarning(existing);
        return;
      }
      await doSave();
    } catch (error) {
      logger.error('Failed to save manual expense', error);
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
      {/* Header */}
      <View className="flex-row justify-between items-center px-6 py-4">
        <TouchableOpacity
          onPress={() => router.back()}
          className="p-2 rounded-full border"
          style={{ backgroundColor: colors.surfaceContainerLow, borderColor: colors.outline + '20' }}
        >
          <X size={20} color={colors.onSurface} />
        </TouchableOpacity>
        <Text style={{ color: colors.onSurface }} className="font-manrope-bold text-lg">{Strings.home.manual_entry}</Text>
        <View className="w-10" />
      </View>

      <View className="flex-1 px-5 pt-4 pb-2">
        {/* Amount Display */}
        <Animated.View
          style={mainStyle}
          className="items-center justify-center pt-2 pb-4"
        >
          <View className="w-full mb-6">
            <Text className="text-onSurfaceVariant font-manrope-bold text-[10px] uppercase tracking-[0.2em] mb-2 px-1">
              What did you buy?
            </Text>
            <TextInput
              className="bg-white/5 border border-white/10 rounded-2xl px-4 py-4 text-white font-manrope-semibold text-lg"
              placeholder="Merchant / Product Name"
              placeholderTextColor="rgba(255,255,255,0.3)"
              value={merchant}
              onChangeText={setMerchant}
              selectionColor={Colors.primary}
            />
          </View>

          <Text className="text-onSurfaceVariant font-manrope-bold text-[10px] uppercase tracking-[0.2em] mb-2">
            Amount Spent
          </Text>
          <View className="flex-row items-baseline">
            <Text className="text-primary font-noto-serif-bold text-3xl mr-2">{getCurrencySymbol()}</Text>
            <Text className="text-white font-noto-serif-bold text-7xl tracking-tighter">
              {amount}
            </Text>
          </View>
        </Animated.View>

        {/* Scrollable controls + keypad */}
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 24 }}
          nestedScrollEnabled
        >
          {/* Category & Keypad */}
          <View>
            <Animated.View style={fadeStyle}>
              {/* Note Input */}
              <View className="mb-4">
                <TextInput
                  className="bg-white/5 border border-white/10 rounded-3xl px-5 py-4 text-white font-manrope-medium text-base"
                  placeholder="Add a note (optional)"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  value={note}
                  onChangeText={setNote}
                  selectionColor={Colors.primary}
                />
              </View>

              {/* Reimbursable Toggle */}
              <View style={{ backgroundColor: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1 }} className="flex-row items-center justify-between px-5 py-4 rounded-3xl mb-4">
                <View className="flex-row items-center">
                  <View className="bg-primary/10 p-2 rounded-xl mr-3">
                    <DollarSign size={18} color={Colors.primary} />
                  </View>
                  <View>
                    <Text className="text-onSurfaceVariant text-[10px] font-manrope-bold uppercase tracking-widest">Reimbursable</Text>
                    <Text className="text-white/60 font-manrope-medium text-xs mt-0.5">Mark as business expense</Text>
                  </View>
                </View>
                <Switch
                  value={isReimbursable}
                  onValueChange={setIsReimbursable}
                  trackColor={{ false: 'rgba(255,255,255,0.1)', true: Colors.primary }}
                  thumbColor={isReimbursable ? 'white' : '#555'}
                />
              </View>

              <TouchableOpacity 
                onPress={() => setIsCategoryModalVisible(true)}
                activeOpacity={0.7}
              >
                <LuminousCard className="p-4 mb-3 flex-row items-center justify-between">
                  <View className="flex-row items-center">
                    <View className="bg-primary/10 p-2 rounded-xl mr-3">
                      <Tag size={18} color={Colors.primary} />
                    </View>
                    <View>
                      <Text className="text-onSurfaceVariant text-[10px] font-manrope-bold uppercase tracking-widest">Category</Text>
                      <Text className="text-white font-manrope-bold">{selectedCategory.title}</Text>
                    </View>
                  </View>
                  <ChevronRight size={20} color={Colors.onSurfaceVariant} />
                </LuminousCard>
              </TouchableOpacity>

              {/* Repeats Toggle */}
              <View style={{ backgroundColor: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1 }} className="flex-row items-center justify-between px-5 py-4 rounded-3xl mb-3">
                <View className="flex-row items-center">
                  <View className="bg-primary/10 p-2 rounded-xl mr-3">
                    <Repeat size={18} color={Colors.primary} />
                  </View>
                  <View>
                    <Text className="text-onSurfaceVariant text-[10px] font-manrope-bold uppercase tracking-widest">Repeats</Text>
                    <Text className="text-white/60 font-manrope-medium text-xs mt-0.5">Schedule as recurring</Text>
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

                  {/* Custom Days Picker */}
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

            {/* Virtual Keypad */}
            <Animated.View
              style={keypadStyle}
              className="flex-row flex-wrap justify-between"
            >
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'delete'].map((k) => (
                <Key key={k} value={k} label={k === 'delete' ? undefined : k} icon={k === 'delete' ? Delete : undefined} />
              ))}
            </Animated.View>

            <Animated.View style={saveButtonStyle}>
              <PeachButton
                title={Strings.review.save}
                onPress={handleSave}
                icon={<Check size={20} color="black" />}
                className="h-16"
              />
            </Animated.View>
          </View>
        </ScrollView>
      </View>

      {/* Category Selection Modal */}
      <Modal
        visible={isCategoryModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setIsCategoryModalVisible(false)}
      >
        <View className="flex-1 justify-end">
          <BlurView intensity={80} tint="dark" style={StyleSheet.absoluteFill} />
          <TouchableOpacity 
            className="flex-1" 
            activeOpacity={1} 
            onPress={() => setIsCategoryModalVisible(false)} 
          />
          <View className="bg-zinc-900 rounded-t-[40px] border-t border-white/10 p-6 pb-12 max-h-[70%]">
            <View className="flex-row justify-between items-center mb-6">
              <Text className="text-white font-manrope-bold text-xl">Select Category</Text>
              <TouchableOpacity onPress={() => setIsCategoryModalVisible(false)}>
                <X size={24} color="white" />
              </TouchableOpacity>
            </View>
            
            <ScrollView showsVerticalScrollIndicator={false}>
              <View className="flex-row flex-wrap justify-between">
                {categories.map((cat) => (
                  <TouchableOpacity
                    key={cat.id}
                    onPress={() => {
                      setSelectedCategory(cat);
                      setIsCategoryModalVisible(false);
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    }}
                    style={{ width: '48%', marginBottom: 16 }}
                    className={`p-4 rounded-3xl border ${selectedCategory.id === cat.id ? 'bg-primary/20 border-primary' : 'bg-white/5 border-white/5'}`}
                  >
                    <View 
                      style={{ backgroundColor: `${cat.color}20` }}
                      className="w-10 h-10 rounded-xl items-center justify-center mb-3"
                    >
                      <LayoutGrid size={20} color={cat.color} />
                    </View>
                    <Text className="text-white font-manrope-semibold">{cat.title}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <DuplicateWarningModal
        visible={duplicateWarning !== null}
        existingExpense={duplicateWarning}
        onSaveAnyway={async () => {
          setDuplicateWarning(null);
          await doSave();
        }}
        onDiscard={() => setDuplicateWarning(null)}
      />
    </SafeAreaView>
  );
}

const StyleSheet = {
  absoluteFill: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  }
};
