import { View, Text, ScrollView, TouchableOpacity, RefreshControl, Platform, Image, TextInput } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, useFocusEffect } from 'expo-router';
import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { documentDirectory, getInfoAsync } from 'expo-file-system/legacy';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, withSpring, useAnimatedReaction, Easing } from 'react-native-reanimated';
import {
  Plus,
  ArrowUpRight,
  ArrowDownLeft,
  Maximize2,
  Scan,
  Edit3,
  Eye,
  EyeOff,
  User,
  DollarSign,
  Search,
  X
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
import { databaseService } from '../../services/DatabaseService';
import { geminiService } from '../../services/GeminiService';
import { logger } from '../../utils/logger';

export default function HomeScreen() {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const styles = useThemeStyles();
  const { settings, getCurrencySymbol, convertAmount, updateSetting } = useSettings();
  const { expenses, isLoading, refreshExpenses } = useExpenses();
  const insets = useSafeAreaInsets();
  const TAB_BAR_HEIGHT = 56 + insets.bottom;
  const [fabOpen, setFabOpen] = useState(false);
  const fabRotation = useSharedValue(0);
  const fabScale1 = useSharedValue(0);
  const fabScale2 = useSharedValue(0);
  const fabScale3 = useSharedValue(0);

  // Net balance
  const [netBalance, setNetBalance] = useState(0);
  const [incomeTotal, setIncomeTotal] = useState(0);
  const [incomeEntries, setIncomeEntries] = useState<any[]>([]);
  const [showIncome, setShowIncome] = useState(false);
  const [digestText, setDigestText] = useState('');
  const [digestLoading, setDigestLoading] = useState(false);
  const [streak, setStreak] = useState(0);
  const streakScale = useSharedValue(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const searchAnim = useSharedValue(0);
  const searchInputRef = useRef<TextInput>(null);

  const filteredExpenses = useMemo(() => {
    if (!searchQuery.trim()) return expenses.slice(0, 10);
    const q = searchQuery.toLowerCase();
    return expenses.filter(e =>
      e.merchant.toLowerCase().includes(q) ||
      (e.note && e.note.toLowerCase().includes(q)) ||
      e.category.toLowerCase().includes(q)
    ).slice(0, 10);
  }, [expenses, searchQuery]);

  const toggleSearch = () => {
    if (showSearch) {
      searchAnim.value = withTiming(0, { duration: 200 });
      setSearchQuery('');
      setTimeout(() => setShowSearch(false), 200);
    } else {
      setShowSearch(true);
      searchAnim.value = withTiming(1, { duration: 300 });
      setTimeout(() => searchInputRef.current?.focus(), 350);
    }
  };

  const searchBarStyle = useAnimatedStyle(() => ({
    height: searchAnim.value * 56,
    opacity: searchAnim.value,
    overflow: 'hidden',
  }));

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

  // Load income data
  const loadIncome = useCallback(async () => {
    try {
      const income = await databaseService.getIncome();
      setIncomeEntries(income);
      const iTotal = income.reduce((sum: number, inc: any) => sum + convertAmount(inc.amount, inc.currency || 'USD').amount, 0);
      setIncomeTotal(iTotal);
      const eTotal = expenses.reduce((sum, exp) => sum + convertAmount(exp.amount, exp.currency || 'USD').amount, 0);
      setNetBalance(iTotal - eTotal);
    } catch {}
  }, [expenses, convertAmount]);

  useEffect(() => {
    loadIncome();
  }, [expenses]);

  // Load weekly digest
  useEffect(() => {
    const loadDigest = async () => {
      const text = await databaseService.getSetting('weekly_digest_text');
      const generatedAt = await databaseService.getSetting('weekly_digest_generated_at');
      const dismissed = await databaseService.getSetting('weekly_digest_dismissed');
      if (text && generatedAt && dismissed !== 'true') {
        const oneWeekAgo = Date.now() - 7 * 86400000;
        if (parseInt(generatedAt) > oneWeekAgo) {
          setDigestText(text);
        }
      }
    };
    loadDigest();
  }, []);

  // Load streak
  useEffect(() => {
    (async () => {
      const s = await databaseService.getStreak();
      setStreak(s);
      streakScale.value = withTiming(1, { duration: 600, easing: Easing.out(Easing.cubic) });
    })();
  }, [expenses]);

  const handleGenerateDigest = async () => {
    setDigestLoading(true);
    try {
      const text = await geminiService.generateWeeklyDigest();
      setDigestText(text);
      const now = Date.now();
      await databaseService.updateSetting('weekly_digest_text', text);
      await databaseService.updateSetting('weekly_digest_generated_at', now.toString());
      await databaseService.updateSetting('weekly_digest_dismissed', 'false');
    } catch (error) {
      logger.error('Failed to generate digest', error);
    } finally {
      setDigestLoading(false);
    }
  };

  const dismissDigest = async () => {
    setDigestText('');
    await databaseService.updateSetting('weekly_digest_dismissed', 'true');
  };

  // Refresh on focus
  useFocusEffect(
    useCallback(() => {
      refreshExpenses();
    }, [refreshExpenses])
  );

  // FAB animation
  const toggleFab = () => {
    if (fabOpen) {
      fabRotation.value = withSpring(0);
      fabScale1.value = withSpring(0);
      fabScale2.value = withSpring(0);
      fabScale3.value = withSpring(0);
    } else {
      fabRotation.value = withSpring(45);
      fabScale1.value = withSpring(1);
      fabScale2.value = withSpring(1);
      fabScale3.value = withSpring(1);
    }
    setFabOpen(!fabOpen);
  };

  const fabRotateStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${fabRotation.value}deg` }],
  }));

  const fabOption1Style = useAnimatedStyle(() => ({
    opacity: fabScale1.value,
    transform: [{ scale: fabScale1.value }, { translateY: -80 }],
  }));

  const fabOption2Style = useAnimatedStyle(() => ({
    opacity: fabScale2.value,
    transform: [{ scale: fabScale2.value }, { translateY: -150 }],
  }));

  const fabOption3Style = useAnimatedStyle(() => ({
    opacity: fabScale3.value,
    transform: [{ scale: fabScale3.value }, { translateY: -220 }],
  }));

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
          <View className="items-center">
            <View className="w-12 h-12 rounded-2xl items-center justify-center overflow-hidden" style={{ backgroundColor: styles.bg.card, borderColor: styles.border.subtle, borderWidth: 1 }}>
              {profileImageUri ? (
                <Image source={{ uri: profileImageUri }} className="w-full h-full" resizeMode="cover" />
              ) : (
                <User size={20} color={styles.icon.muted} />
              )}
            </View>
            {streak > 0 && (
              <Animated.View style={[{ transform: [{ scale: streakScale }] }, { backgroundColor: Colors.primary + '20', borderColor: Colors.primary + '30', borderWidth: 1, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 2 }]} className="flex-row items-center mt-1.5">
                <Image source={require('../../assets/images/flameheart-emoji.gif')} style={{ width: 14, height: 14 }} resizeMode="contain" />
                <Text style={{ color: Colors.primary, fontSize: 10, fontFamily: 'Manrope_700Bold', marginLeft: 2 }}>{streak}</Text>
              </Animated.View>
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

        {/* Net Balance */}
        <Animated.View style={fadeSlideStyle} className="px-5 mb-8">
          <LuminousCard className="p-5" style={{ borderColor: styles.border.subtle, borderWidth: 1 }}>
            <Text style={{ color: styles.text.onSurfaceVariant60 }} className="font-manrope-bold text-[10px] uppercase tracking-widest mb-3">Net Balance</Text>
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center">
                <View className="bg-green-500/10 p-2 rounded-xl mr-3">
                  <ArrowDownLeft size={16} color="#4ADE80" />
                </View>
                <View>
                  <Text style={{ color: styles.text.onSurfaceVariant40 }} className="font-manrope-medium text-[10px] uppercase tracking-widest">Income</Text>
                  <Text style={{ color: '#4ADE80' }} className="font-manrope-bold text-sm">
                    {settings.prices_visible !== 'false' ? `${getCurrencySymbol()}${incomeTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '••••'}
                  </Text>
                </View>
              </View>
              <View className="flex-row items-center">
                <View className="bg-primary/10 p-2 rounded-xl mr-3">
                  <ArrowUpRight size={16} color={Colors.primary} />
                </View>
                <View>
                  <Text style={{ color: styles.text.onSurfaceVariant40 }} className="font-manrope-medium text-[10px] uppercase tracking-widest">Expenses</Text>
                  <Text style={{ color: Colors.primary }} className="font-manrope-bold text-sm">
                    {settings.prices_visible !== 'false' ? `${getCurrencySymbol()}${totalSpending.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '••••'}
                  </Text>
                </View>
              </View>
              <View className="items-end">
                <Text style={{ color: styles.text.onSurfaceVariant40 }} className="font-manrope-medium text-[10px] uppercase tracking-widest">Net</Text>
                <Text style={{ color: netBalance >= 0 ? '#4ADE80' : '#FF8A80' }} className="font-noto-serif-bold text-xl">
                  {settings.prices_visible !== 'false' ? `${getCurrencySymbol()}${netBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '••••'}
                </Text>
              </View>
            </View>
          </LuminousCard>
        </Animated.View>

        {/* Weekly Digest Card */}
        {digestText ? (
          <Animated.View style={fadeSlideStyle} className="px-5 mb-8">
            <LuminousCard className="p-6" style={{ borderColor: Colors.primary + '20', borderWidth: 1, backgroundColor: Colors.primary + '08' }}>
              <View className="flex-row justify-between items-start mb-3">
                <View className="flex-row items-center">
                  <View className="bg-primary/20 p-2 rounded-xl mr-3">
                    <Edit3 size={16} color={Colors.primary} />
                  </View>
                  <Text style={{ color: Colors.primary }} className="font-noto-serif-bold text-lg">Weekly Digest</Text>
                </View>
                <TouchableOpacity onPress={dismissDigest} className="p-1" hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <X size={16} color={styles.icon.muted} />
                </TouchableOpacity>
              </View>
              <Text style={{ color: styles.text.onSurface }} className="font-manrope-medium text-sm leading-6">
                {digestText}
              </Text>
            </LuminousCard>
          </Animated.View>
        ) : !digestLoading ? (
          <Animated.View style={fadeSlideStyle} className="px-5 mb-8">
            <TouchableOpacity
              onPress={handleGenerateDigest}
              style={{ borderColor: styles.border.subtle, borderWidth: 1, borderStyle: 'dashed' }}
              className="p-5 rounded-3xl flex-row items-center justify-center"
            >
              <Edit3 size={18} color={Colors.primary} />
              <Text style={{ color: Colors.primary }} className="font-manrope-semibold text-sm ml-2">Generate Weekly Digest</Text>
            </TouchableOpacity>
          </Animated.View>
        ) : null}

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

        {/* Income Section */}
        {incomeEntries.length > 0 && (
          <Animated.View style={fadeStyle} className="mb-8">
            <TouchableOpacity
              onPress={() => setShowIncome(!showIncome)}
              className="px-6 mb-4 flex-row justify-between items-center"
            >
              <View className="flex-row items-center">
                <ArrowDownLeft size={16} color="#4ADE80" className="mr-2" />
                <Text style={{ color: styles.text.onSurface }} className="font-noto-serif-bold text-2xl tracking-tight ml-2">Income</Text>
                <Text className="text-green-400 font-manrope-bold text-sm ml-3">{getCurrencySymbol()}{incomeTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}</Text>
              </View>
            </TouchableOpacity>
            {showIncome && incomeEntries.slice(0, 5).map((inc: any) => {
              const incValue = convertAmount(inc.amount, inc.currency || 'USD');
              return (
                <View key={inc.id} style={{ backgroundColor: 'rgba(74,222,128,0.05)', borderColor: 'rgba(74,222,128,0.1)', borderWidth: 1 }} className="mx-6 mb-3 py-4 px-5 rounded-3xl flex-row justify-between items-center">
                  <View className="flex-1 mr-4">
                    <Text style={{ color: styles.text.onSurface }} className="font-manrope-bold text-base" numberOfLines={1}>{inc.source}</Text>
                    {inc.note && <Text className="text-onSurfaceVariant font-manrope-medium text-xs mt-0.5">{inc.note}</Text>}
                  </View>
                  <Text style={{ color: '#4ADE80' }} className="font-noto-serif-bold text-xl">
                    {settings.prices_visible !== 'false' ? `+${getCurrencySymbol()}${incValue.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '••••'}
                  </Text>
                </View>
              );
            })}
          </Animated.View>
        )}

        {/* Recent Expenses List */}
        <Animated.View style={fadeStyle}>
          <View className="px-6 mb-6 flex-row justify-between items-center">
            <View className="flex-row items-center">
              <Text style={{ color: styles.text.onSurface }} className="font-noto-serif-bold text-2xl tracking-tight">Recent Flow</Text>
              <TouchableOpacity
                onPress={toggleSearch}
                className="ml-3 p-2"
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Search size={18} color={showSearch ? Colors.primary : styles.icon.muted} />
              </TouchableOpacity>
            </View>
            <TouchableOpacity onPress={() => router.push('/(tabs)/analytics')}>
              <View style={{ backgroundColor: styles.bg.white5, borderColor: styles.border.subtle, borderWidth: 1 }} className="px-4 py-2 rounded-xl">
                <Text className="text-primary font-manrope-bold text-xs uppercase tracking-widest">See all</Text>
              </View>
            </TouchableOpacity>
          </View>

          {/* Search Bar */}
          {showSearch && (
            <Animated.View style={searchBarStyle} className="px-6 mb-4">
              <View style={{ backgroundColor: styles.bg.white5, borderColor: styles.border.subtle, borderWidth: 1 }} className="flex-row items-center rounded-2xl px-4 py-2">
                <Search size={16} color={styles.icon.muted} />
                <TextInput
                  ref={searchInputRef}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder="Search expenses..."
                  placeholderTextColor={styles.text.onSurfaceVariant60}
                  style={{ color: styles.text.onSurface, flex: 1 }}
                  className="font-manrope-medium text-base ml-2"
                  selectionColor={Colors.primary}
                />
                {searchQuery.length > 0 && (
                  <TouchableOpacity onPress={() => setSearchQuery('')} className="ml-2">
                    <X size={16} color={styles.icon.muted} />
                  </TouchableOpacity>
                )}
              </View>
            </Animated.View>
          )}

          {searchQuery.trim() && filteredExpenses.length === 0 ? (
            <View className="px-6 py-10 items-center">
              <Text style={{ color: styles.text.onSurfaceVariant60 }} className="font-manrope-medium text-sm text-center">
                No expenses found for "{searchQuery}"
              </Text>
            </View>
          ) : (
            <ExpenseList expenses={filteredExpenses} isLoading={isLoading} searchQuery={searchQuery} />
          )}
        </Animated.View>
      </ScrollView>

      {/* FAB Speed Dial */}
      <View
        style={{
          position: 'absolute',
          bottom: TAB_BAR_HEIGHT + 20,
          right: 20,
          alignItems: 'center',
        }}
      >
        {/* Speed Dial Options */}
        <Animated.View style={fabOption3Style} className="items-center mb-2">
          <TouchableOpacity
            onPress={() => { toggleFab(); router.push('/income/manual' as any); }}
            style={{ backgroundColor: '#4ADE80' }}
            className="w-12 h-12 rounded-full items-center justify-center shadow-lg"
          >
            <ArrowDownLeft size={20} color="black" />
          </TouchableOpacity>
          <Text className="text-white/60 font-manrope-medium text-[10px] mt-1">Income</Text>
        </Animated.View>

        <Animated.View style={fabOption2Style} className="items-center mb-2">
          <TouchableOpacity
            onPress={() => { toggleFab(); router.push('/expense/manual'); }}
            className="w-12 h-12 rounded-full items-center justify-center shadow-lg"
            style={{ backgroundColor: Colors.primary }}
          >
            <Edit3 size={20} color="black" />
          </TouchableOpacity>
          <Text className="text-white/60 font-manrope-medium text-[10px] mt-1">Expense</Text>
        </Animated.View>

        <Animated.View style={fabOption1Style} className="items-center mb-2">
          <TouchableOpacity
            onPress={() => { toggleFab(); router.push('/scan'); }}
            style={{ backgroundColor: '#A78BFA' }}
            className="w-12 h-12 rounded-full items-center justify-center shadow-lg"
          >
            <Scan size={20} color="black" />
          </TouchableOpacity>
          <Text className="text-white/60 font-manrope-medium text-[10px] mt-1">Scan</Text>
        </Animated.View>

        {/* Main FAB */}
        <TouchableOpacity
          onPress={toggleFab}
          activeOpacity={0.8}
          style={{
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
          <Animated.View style={fabRotateStyle}>
            <Plus color="black" size={28} />
          </Animated.View>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
