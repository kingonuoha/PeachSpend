import { View, Text, ScrollView, TouchableOpacity, RefreshControl, Platform, Image } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, useFocusEffect } from 'expo-router';
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { documentDirectory, getInfoAsync } from 'expo-file-system/legacy';
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import {
  Plus,
  ArrowUpRight,
  ArrowDownLeft,
  Maximize2,
  Scan,
  Edit3,
  Eye,
  EyeOff,
  User
} from 'lucide-react-native';

import { Strings } from '../../constants/strings';
import { Colors } from '../../constants/tokens';
import { useTheme } from '../../components/ui/ThemeProvider';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import { useSettings } from '../../components/ui/SettingsProvider';
import { useExpenses } from '../../hooks/useExpenses';
import { ExpenseList } from '../../components/expense/ExpenseList';
import { LuminousCard } from '../../components/ui/LuminousCard';
import { DateRangePicker } from '../../components/ui/DateRangePicker';

export default function HomeScreen() {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const styles = useThemeStyles();
  const { settings, getCurrencySymbol, convertAmount, updateSetting } = useSettings();
  const { expenses, isLoading, refreshExpenses } = useExpenses();
  const insets = useSafeAreaInsets();
  const TAB_BAR_HEIGHT = 56 + insets.bottom;

  type BudgetTimeframe = 'monthly' | 'lifetime' | 'custom';
  const [budgetTimeframe, setBudgetTimeframe] = useState<BudgetTimeframe>(
    (settings.budget_timeframe as BudgetTimeframe) || 'monthly'
  );
  const [profileImageUri, setProfileImageUri] = useState<string | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [budgetCustomStart, setBudgetCustomStart] = useState<Date>(
    settings.budget_custom_start ? new Date(parseInt(settings.budget_custom_start)) : new Date(new Date().getFullYear(), 0, 1)
  );
  const [budgetCustomEnd, setBudgetCustomEnd] = useState<Date>(
    settings.budget_custom_end ? new Date(parseInt(settings.budget_custom_end)) : new Date()
  );

  useEffect(() => {
    const pic = settings.profile_picture;
    if (pic) {
      const path = (documentDirectory || '') + 'profile_pics/' + pic;
      getInfoAsync(path).then((info) => {
        if (info.exists) setProfileImageUri(path);
      }).catch(() => {});
    } else {
      setProfileImageUri(null);
    }
  }, [settings.profile_picture]);

  // Refresh on focus
  useFocusEffect(
    useCallback(() => {
      refreshExpenses();
    }, [refreshExpenses])
  );

  // Entrance animation
  const fadeAnim = useSharedValue(0);
  const slideAnim = useSharedValue(24);

  useEffect(() => {
    fadeAnim.value = withTiming(1, { duration: 500 });
    slideAnim.value = withTiming(0, { duration: 500 });
  }, []);

  const fadeSlideStyle = useAnimatedStyle(() => ({
    opacity: fadeAnim.value,
    transform: [{ translateY: slideAnim.value }],
  }));

  const fadeStyle = useAnimatedStyle(() => ({
    opacity: fadeAnim.value,
  }));

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return Strings.home.greeting_morning;
    if (hour < 18) return Strings.home.greeting_afternoon;
    return Strings.home.greeting_evening;
  }, []);

  const totalSpending = useMemo(() => {
    return expenses.reduce((sum, exp) => sum + convertAmount(exp.amount, exp.currency || 'USD').amount, 0);
  }, [expenses, convertAmount]);

  const todaySpending = useMemo(() => {
    const today = new Date().setHours(0, 0, 0, 0);
    return expenses
      .filter(exp => new Date(exp.created_at).setHours(0, 0, 0, 0) === today)
      .reduce((sum, exp) => sum + convertAmount(exp.amount, exp.currency || 'USD').amount, 0);
  }, [expenses, convertAmount]);

  const budgetCap = useMemo(() => {
    return parseFloat(settings.monthly_budget) || 0;
  }, [settings.monthly_budget]);

  const budgetSpending = useMemo(() => {
    const now = new Date();
    let threshold: number | null = null;

    if (budgetTimeframe === 'monthly') {
      threshold = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    } else if (budgetTimeframe === 'custom') {
      return expenses
        .filter(exp => exp.created_at >= budgetCustomStart.getTime() && exp.created_at <= budgetCustomEnd.getTime())
        .reduce((sum, exp) => sum + convertAmount(exp.amount, exp.currency || 'USD').amount, 0);
    }

    return expenses
      .filter(exp => threshold === null || exp.created_at >= threshold)
      .reduce((sum, exp) => sum + convertAmount(exp.amount, exp.currency || 'USD').amount, 0);
  }, [expenses, convertAmount, budgetTimeframe, budgetCustomStart, budgetCustomEnd]);

  const budgetProgress = budgetCap > 0 ? Math.min(budgetSpending / budgetCap, 1) : 0;
  const budgetRemaining = budgetCap - budgetSpending;

  const budgetLabel = budgetTimeframe === 'monthly' ? 'Monthly Budget'
    : budgetTimeframe === 'lifetime' ? 'Lifetime Budget'
    : 'Budget Range';

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: colors.background }}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 140 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={refreshExpenses}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {/* Header */}
        <Animated.View style={fadeSlideStyle} className="px-6 pt-10 mb-8 flex-row justify-between items-center">
          <View>
            <Text className="text-onSurfaceVariant/60 font-manrope-medium text-base tracking-tight">
              {greeting},
            </Text>
            <Text style={{ color: styles.text.onSurface }} className="font-noto-serif-bold text-4xl mt-1">
              {settings.profile_name || 'Peach User'}
            </Text>
          </View>
          <View className="w-12 h-12 rounded-2xl items-center justify-center overflow-hidden" style={{ backgroundColor: styles.bg.card, borderColor: styles.border.subtle, borderWidth: 1 }}>
            {profileImageUri ? (
              <Image source={{ uri: profileImageUri }} className="w-full h-full" resizeMode="cover" />
            ) : (
              <User size={20} color={styles.icon.muted} />
            )}
          </View>
        </Animated.View>

        {/* Balance Card */}
        <Animated.View style={fadeSlideStyle} className="px-5 mb-10">
          <LuminousCard variant="highest" className="p-8 shadow-2xl" style={{ borderColor: styles.border.card, borderWidth: 1 }}>
            <View className="flex-row justify-between items-start">
              <View className="flex-1">
                <View className="flex-row items-center mb-3">
                  <Text className="text-onSurfaceVariant font-manrope-bold text-xs uppercase tracking-[0.2em]">
                    {Strings.home.total_spending}
                  </Text>
                  <TouchableOpacity
                    onPress={() => updateSetting('prices_visible', settings.prices_visible === 'false' ? 'true' : 'false')}
                    className="ml-2 p-1"
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    {settings.prices_visible === 'false' ? (
                      <EyeOff size={16} color={Colors.onSurfaceVariant} />
                    ) : (
                      <Eye size={16} color={Colors.primary} />
                    )}
                  </TouchableOpacity>
                </View>
                {settings.prices_visible !== 'false' ? (
                  <View className="flex-row items-baseline">
                    <Text style={{ color: colors.primary }} className="font-noto-serif-bold text-2xl mr-1">{getCurrencySymbol()}</Text>
                    <Text style={{ color: colors.onSurface }} className="font-noto-serif-bold text-5xl tracking-tighter">
                      {totalSpending.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </Text>
                  </View>
                ) : (
                  <View className="flex-row items-baseline">
                    <Text style={{ color: colors.primary }} className="font-noto-serif-bold text-2xl mr-1">{getCurrencySymbol()}</Text>
                    <Text style={{ color: colors.onSurface }} className="font-noto-serif-bold text-5xl tracking-tighter">
                      ••••
                    </Text>
                  </View>
                )}
              </View>
              <View className="bg-primary/10 p-4 rounded-3xl border border-primary/20">
                <Maximize2 size={24} color={Colors.primary} />
              </View>
            </View>

            <View className="flex-row mt-10 gap-4">
              <TouchableOpacity
                onPress={() => router.push('/scan')}
                className="flex-1 bg-primary h-[60px] rounded-3xl flex-row items-center justify-center shadow-lg"
              >
                <Scan size={20} color="black" />
                <Text className="text-black font-manrope-bold ml-2 text-base">Neural Scan</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => router.push('/expense/manual')}
                style={{ backgroundColor: styles.bg.white5, borderColor: styles.border.card, borderWidth: 1 }}
                className="flex-1 h-[60px] rounded-3xl flex-row items-center justify-center"
              >
                <Edit3 size={20} color={styles.icon.default} />
                <Text style={{ color: styles.text.onSurface }} className="font-manrope-bold ml-2 text-base">Manual</Text>
              </TouchableOpacity>
            </View>
          </LuminousCard>
        </Animated.View>

        {/* Bento Stats */}
        <View className="px-5 mb-10 flex-row gap-4">
          <LuminousCard className="flex-1 p-6" style={{ borderColor: styles.border.subtle, borderWidth: 1 }}>
            <Text style={{ color: styles.text.onSurfaceVariant60 }} className="font-manrope-bold text-[10px] uppercase tracking-widest mb-2">Today</Text>
            {settings.prices_visible !== 'false' ? (
              <View className="flex-row items-baseline">
                <Text style={{ color: colors.primary }} className="font-noto-serif-bold text-sm mr-0.5">{getCurrencySymbol()}</Text>
                <Text style={{ color: colors.onSurface }} className="font-noto-serif-bold text-2xl tracking-tighter">
                  {todaySpending.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </Text>
              </View>
            ) : (
              <Text style={{ color: colors.onSurface }} className="font-noto-serif-bold text-2xl tracking-tighter">••••</Text>
            )}
          </LuminousCard>
          <LuminousCard className="flex-1 p-6" style={{ backgroundColor: styles.bg.primary5, borderColor: styles.border.subtle, borderWidth: 1 }}>
            <Text style={{ color: styles.text.primary60 }} className="font-manrope-bold text-[10px] uppercase tracking-widest mb-2">Flow Velocity</Text>
            <Text style={{ color: styles.text.onSurface }} className="font-noto-serif-bold text-2xl tracking-tighter">Smooth</Text>
          </LuminousCard>
        </View>

        {/* Budget Progress Bar */}
        {budgetCap > 0 && (
          <Animated.View style={fadeSlideStyle} className="px-5 mb-8">
            <LuminousCard className="p-6" style={{ borderColor: styles.border.subtle, borderWidth: 1 }}>
              <View className="flex-row justify-between items-center mb-3">
                <Text style={{ color: styles.text.onSurfaceVariant60 }} className="font-manrope-bold text-[10px] uppercase tracking-widest">
                  {budgetLabel}
                </Text>
                <Text style={{ color: styles.text.onSurfaceVariant }} className="font-manrope-medium text-xs">
                  {settings.prices_visible !== 'false'
                    ? `${getCurrencySymbol()}${budgetSpending.toLocaleString(undefined, { maximumFractionDigits: 0 })} / ${getCurrencySymbol()}${budgetCap.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                    : '•••• / ••••'}
                </Text>
              </View>

              <View style={{ backgroundColor: styles.bg.white5 }} className="w-full h-2 rounded-full overflow-hidden">
                <View
                  style={{
                    width: `${budgetProgress * 100}%`,
                    backgroundColor: budgetProgress > 0.8 ? '#ef4444' : budgetProgress > 0.5 ? Colors.primary : '#22c55e',
                  }}
                  className="h-full rounded-full"
                />
              </View>

              {budgetRemaining > 0 ? (
                <Text style={{ color: styles.text.onSurfaceVariant60 }} className="font-manrope-medium text-xs mt-2">
                  {settings.prices_visible !== 'false'
                    ? `${getCurrencySymbol()}${budgetRemaining.toLocaleString(undefined, { maximumFractionDigits: 0 })} remaining`
                    : '•••• remaining'}
                </Text>
              ) : (
                <Text style={{ color: styles.text.error }} className="font-manrope-medium text-xs mt-2">Budget exceeded</Text>
              )}

              {/* Timeframe Toggle */}
              <View style={{ backgroundColor: styles.bg.white5, borderColor: styles.border.subtle, borderWidth: 1 }} className="flex-row rounded-xl p-1 mt-4">
                {(['monthly', 'lifetime', 'custom'] as const).map((tf) => (
                  <TouchableOpacity
                    key={tf}
                    onPress={() => {
                      setBudgetTimeframe(tf);
                      updateSetting('budget_timeframe', tf);
                      if (tf === 'custom') setShowDatePicker(true);
                    }}
                    className={`flex-1 py-2 rounded-lg ${budgetTimeframe === tf ? 'bg-primary' : ''}`}
                  >
                    <Text className={`text-center font-manrope-bold text-[10px] uppercase tracking-widest ${budgetTimeframe === tf ? 'text-black' : ''}`}
                      style={budgetTimeframe !== tf ? { color: styles.text.onSurfaceVariant } : {}}>
                      {tf === 'monthly' ? 'Month' : tf === 'lifetime' ? 'All' : 'Custom'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </LuminousCard>
          </Animated.View>
        )}

        {/* Date Range Picker Modal */}
        <DateRangePicker
          visible={showDatePicker}
          startDate={budgetCustomStart}
          endDate={budgetCustomEnd}
          onApply={(start, end) => {
            setBudgetCustomStart(start);
            setBudgetCustomEnd(end);
            updateSetting('budget_custom_start', start.getTime().toString());
            updateSetting('budget_custom_end', end.getTime().toString());
            setShowDatePicker(false);
          }}
          onClose={() => setShowDatePicker(false)}
        />

        {/* Recent Expenses List */}
        <Animated.View style={fadeStyle}>
          <View className="px-6 mb-6 flex-row justify-between items-center">
            <Text style={{ color: styles.text.onSurface }} className="font-noto-serif-bold text-2xl tracking-tight">Recent Flow</Text>
            <TouchableOpacity onPress={() => router.push('/(tabs)/analytics')}>
              <View style={{ backgroundColor: styles.bg.white5, borderColor: styles.border.subtle, borderWidth: 1 }} className="px-4 py-2 rounded-xl">
                <Text className="text-primary font-manrope-bold text-xs uppercase tracking-widest">See all</Text>
              </View>
            </TouchableOpacity>
          </View>
          <ExpenseList expenses={expenses.slice(0, 10)} isLoading={isLoading} />
        </Animated.View>
      </ScrollView>

      {/* FAB */}
      <TouchableOpacity
        onPress={() => router.push('/scan')}
        activeOpacity={0.8}
        style={{
          position: 'absolute',
          bottom: TAB_BAR_HEIGHT + 20,
          right: 20,
          width: 60,
          height: 60,
          borderRadius: 30,
          backgroundColor: Colors.primary,
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: Colors.primary,
          shadowOffset: { width: 0, height: 6 },
          shadowOpacity: 0.5,
          shadowRadius: 16,
          elevation: 10,
        }}
      >
        <Plus color="black" size={28} />
      </TouchableOpacity>
    </SafeAreaView>
  );
}
