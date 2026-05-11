import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, TextInput, ScrollView, Alert, Switch, Pressable, Modal, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { 
  Key, 
  Trash2, 
  Info, 
  Moon, 
  Bell, 
  Globe, 
  Database, 
  AlertTriangle,
  ChevronRight,
  Eye,
  EyeOff,
  User,
  Check,
  Sun,
  Fingerprint
} from 'lucide-react-native';
import { databaseService } from '../../services/DatabaseService';
import { Strings } from '../../constants/strings';
import { Colors } from '../../constants/tokens';
import { LuminousCard } from '../../components/ui/LuminousCard';
import { PeachButton } from '../../components/ui/PeachButton';
import { useSettings } from '../../components/ui/SettingsProvider';
import { useExpenses } from '../../hooks/useExpenses';
import { useTheme } from '../../components/ui/ThemeProvider';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import { notificationService } from '../../services/NotificationService';
import { logger } from '../../utils/logger';
import * as Haptics from 'expo-haptics';
import { CurrencyConversionModal } from '../../components/settings/CurrencyConversionModal';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'NGN', 'CAD', 'AUD'];

export default function SettingsScreen() {
  const { colors, isDark } = useTheme();
  const styles = useThemeStyles();
  const { settings, updateSetting, isLoading, conversionRates, getCurrencySymbol } = useSettings();
  const { expenses, refreshExpenses } = useExpenses();
  const [localApiKey, setLocalApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [isCurrencyModalVisible, setIsCurrencyModalVisible] = useState(false);
  const [pendingCurrency, setPendingCurrency] = useState<string | null>(null);
  const [isConversionModalVisible, setIsConversionModalVisible] = useState(false);
  const [budgetValue, setBudgetValue] = useState(settings.monthly_budget || '');
  const budgetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setBudgetValue(settings.monthly_budget || '');
  }, [settings.monthly_budget]);

  useEffect(() => {
    if (settings.gemini_api_key) {
      setLocalApiKey(settings.gemini_api_key);
    }
  }, [settings.gemini_api_key]);

  const handleUpdateApiKey = async () => {
    try {
      if (!localApiKey.trim()) {
        Alert.alert('Error', 'API Key cannot be empty.');
        return;
      }
      await updateSetting('gemini_api_key', localApiKey);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Success', 'Gemini intelligence updated.');
    } catch (error) {
      logger.error('API Key update failed', error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const handleToggleTheme = async () => {
    const nextTheme = settings.theme === 'dark' ? 'light' : 'dark';
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await updateSetting('theme', nextTheme);
  };

  const handleCurrencySelect = (currency: string) => {
    if (currency === settings.currency) {
      setIsCurrencyModalVisible(false);
      return;
    }

    setPendingCurrency(currency);
    setIsCurrencyModalVisible(false);

    // If there are expenses, ask for conversion
    if (expenses.length > 0) {
      setTimeout(() => setIsConversionModalVisible(true), 500);
    } else {
      updateSetting('currency', currency);
    }
  };

  const handleConversionConfirm = async (_rate: number) => {
    try {
      if (pendingCurrency) {
        await databaseService.convertExpenses(pendingCurrency);
        await updateSetting('currency', pendingCurrency);
        await refreshExpenses();
        setIsConversionModalVisible(false);
        setPendingCurrency(null);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert('Success', `Wealth rebased to ${pendingCurrency}.`);
      }
    } catch (error) {
      logger.error('Currency conversion failed', error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const handleUpdateRate = async (currencyCode: string, newRate: number) => {
    try {
      const currentRates = { ...conversionRates };
      currentRates[currencyCode] = newRate;
      await updateSetting('conversion_rates', JSON.stringify(currentRates));
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (error) {
      logger.error('Failed to update rate', error);
    }
  };

  const handleClearTransactions = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      'Purge Transactions',
      'This will delete all recorded expenses but keep your settings and API key. Proceed?',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Purge', 
          style: 'destructive',
          onPress: async () => {
            await databaseService.clearAllData();
            await refreshExpenses();
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            Alert.alert('Purged', 'All transaction history has been cleared.');
          }
        }
      ]
    );
  };

  const handleResetApp = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    Alert.alert(
      'Total Reset',
      'CRITICAL: This will wipe EVERYTHING, including settings, API keys, and expenses. The app will restart. Proceed?',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Wipe Everything', 
          style: 'destructive',
          onPress: async () => {
            await databaseService.resetApp();
            await refreshExpenses();
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            Alert.alert('Reset', 'State has been factory-reset.');
          }
        }
      ]
    );
  };

  if (isLoading) return <View style={{ backgroundColor: styles.bg.screen, flex: 1 }} />;

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: colors.background }}>
      <ScrollView 
        className="flex-1 px-5" 
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 120, paddingTop: 20 }}
      >
        <View className="mb-8">
          <Text style={{ color: colors.onSurface }} className="font-noto-serif-bold text-3xl">
            {Strings.settings.title}
          </Text>
          <Text style={{ color: colors.onSurfaceVariant }} className="font-manrope-medium mt-1">
            Refined controls for your wealth.
          </Text>
        </View>

        {/* Bento Grid: AI & Currency */}
        <View className="flex-row mb-4 gap-4">
          <LuminousCard className="flex-1 p-5 aspect-square justify-between h-[180px]">
            <Pressable onPress={() => setIsCurrencyModalVisible(true)} className="flex-1 justify-between">
              <View className="bg-primary/10 w-10 h-10 rounded-full items-center justify-center">
                <Globe size={20} color={Colors.primary} />
              </View>
              <View>
                <Text className="text-onSurfaceVariant font-manrope-bold text-[10px] uppercase tracking-widest mb-1">
                  Currency
                </Text>
                <View className="flex-row items-center justify-between">
                  <Text style={{ color: colors.onSurface }} className="font-noto-serif-bold text-xl">
                    {settings.currency || 'USD'}
                  </Text>
                  <ChevronRight size={16} color={colors.onSurfaceVariant} />
                </View>
              </View>
            </Pressable>
          </LuminousCard>

          <LuminousCard className="flex-1 p-5 aspect-square justify-between h-[180px]">
             <Pressable onPress={handleToggleTheme} className="flex-1 justify-between">
              <View className="bg-primary/10 w-10 h-10 rounded-full items-center justify-center">
                {settings.theme === 'dark' ? <Moon size={20} color={Colors.primary} /> : <Sun size={20} color={Colors.primary} />}
              </View>
              <View>
                <Text className="text-onSurfaceVariant font-manrope-bold text-[10px] uppercase tracking-widest mb-1">
                  Appearance
                </Text>
                <Text style={{ color: styles.text.onSurface }} className="font-noto-serif-bold text-xl uppercase">
                  {settings.theme || 'dark'}
                </Text>
              </View>
            </Pressable>
          </LuminousCard>
        </View>

        {/* Gemini API Key Block */}
        <LuminousCard className="mb-6 p-6">
          <View className="flex-row items-center mb-4">
            <View className="bg-primary/20 p-2 rounded-xl">
              <Key size={18} color={Colors.primary} />
            </View>
            <Text style={{ color: styles.text.onSurface }} className="font-manrope-bold ml-3 text-lg">
              Gemini Intelligence
            </Text>
          </View>
          
          <View className="relative mb-4">
            <TextInput
              value={localApiKey}
              onChangeText={setLocalApiKey}
              secureTextEntry={!showKey}
              placeholder="Enter Google AI Key"
              placeholderTextColor={styles.text.onSurfaceVariant60}
              style={{ backgroundColor: styles.bg.white5, color: styles.text.onSurface, borderColor: styles.border.subtle, borderWidth: 1 }}
              className="px-5 py-4 rounded-2xl font-manrope-medium pr-12"
            />
            <Pressable 
              onPress={() => setShowKey(!showKey)}
              className="absolute right-4 top-4"
            >
              {showKey ? (
                <EyeOff size={20} color={Colors.onSurfaceVariant} />
              ) : (
                <Eye size={20} color={Colors.onSurfaceVariant} />
              )}
            </Pressable>
          </View>

          <PeachButton 
            title="Securely Save Key" 
            onPress={handleUpdateApiKey}
            className="h-14"
          />
        </LuminousCard>

        {/* Preferences Bento */}
        <Text className="text-onSurfaceVariant font-manrope-bold text-[10px] uppercase tracking-[0.2em] mb-4 ml-1">
          Preferences
        </Text>
        
        <View className="flex-row gap-4 mb-8">
          <LuminousCard className="flex-1 p-5">
            <View className="mb-3">
              <Fingerprint size={20} color={Colors.primary} />
            </View>
            <Text style={{ color: styles.text.onSurface }} className="font-manrope-bold">Biometric Lock</Text>
            <Text className="text-onSurfaceVariant text-xs mt-1">Fingerprint on launch</Text>
            <Switch 
              value={settings.biometric_enabled === 'true'} 
              onValueChange={async (val) => {
                await updateSetting('biometric_enabled', val.toString());
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }} 
              trackColor={{ true: Colors.primary }}
              thumbColor={Colors.white}
              style={{ alignSelf: 'flex-start', marginTop: 12, transform: [{ scale: 0.8 }] }}
            />
          </LuminousCard>
          
          <LuminousCard className="flex-1 p-5">
            <View className="mb-3">
              <Bell size={20} color={Colors.onSurfaceVariant} />
            </View>
            <Text style={{ color: styles.text.onSurface }} className="font-manrope-bold">Alerts</Text>
            <Text className="text-onSurfaceVariant text-xs mt-1">Smart notifications</Text>
            <Switch 
              value={settings.notifications_enabled === 'true'} 
              onValueChange={async (val) => {
                if (val) {
                  const granted = await notificationService.requestPermissions();
                  if (granted) {
                    await updateSetting('notifications_enabled', 'true');
                  }
                } else {
                  await updateSetting('notifications_enabled', 'false');
                }
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }} 
              trackColor={{ true: Colors.primary }}
              thumbColor={Colors.white}
              style={{ alignSelf: 'flex-start', marginTop: 12, transform: [{ scale: 0.8 }] }}
            />
          </LuminousCard>
        </View>

        {/* Monthly Budget */}
        <Text className="text-onSurfaceVariant font-manrope-bold text-[10px] uppercase tracking-[0.2em] mb-4 ml-1">
          Monthly Limit
        </Text>
        <LuminousCard className="mb-8 p-6">
          <View className="flex-row items-center justify-between">
            <View className="flex-1 mr-4">
              <Text style={{ color: styles.text.onSurface }} className="font-manrope-bold text-lg mb-1">Monthly Budget</Text>
              <Text className="text-onSurfaceVariant text-xs font-manrope-medium">
                Set a spending cap for each month
              </Text>
            </View>
            <View className="flex-row items-center">
              <Text className="text-primary font-manrope-bold text-sm mr-2">{getCurrencySymbol()}</Text>
              <TextInput
                value={budgetValue}
                onChangeText={(v) => {
                  setBudgetValue(v);
                  if (budgetTimer.current) clearTimeout(budgetTimer.current);
                  budgetTimer.current = setTimeout(() => {
                    updateSetting('monthly_budget', v || '0');
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  }, 600);
                }}
                keyboardType="numeric"
                style={{ backgroundColor: styles.bg.white5, color: styles.text.onSurface, borderColor: styles.border.subtle, borderWidth: 1 }}
                className="px-4 py-3 rounded-xl font-manrope-bold text-lg w-28 text-right"
                placeholder="0"
                placeholderTextColor={styles.text.onSurfaceVariant60}
              />
            </View>
          </View>
        </LuminousCard>

        {/* Conversion Rates Section */}
        <Animated.View entering={FadeInDown.delay(400)}>
          <Text className="text-primary font-manrope-bold text-[10px] uppercase tracking-[0.2em] mb-4 ml-1">
            Global Parity Rates (vs USD)
          </Text>
          <LuminousCard className="mb-8 p-6">
            {CURRENCIES.filter(c => c !== 'USD').map((c) => (
              <View key={c} className="flex-row items-center justify-between py-4 last:border-0" style={{ borderBottomWidth: 1, borderBottomColor: styles.border.subtle }}>
                <View className="flex-row items-center">
                  <Text style={{ color: styles.text.onSurface }} className="font-manrope-bold text-sm w-12">{c}</Text>
                  <Text style={{ color: styles.text.onSurfaceVariant40 }} className="text-[10px] font-manrope-medium ml-2">1 {c} =</Text>
                </View>
                <View className="flex-row items-center">
                  <TextInput
                    defaultValue={(conversionRates[c] || 1).toString()}
                    onEndEditing={(e) => handleUpdateRate(c, parseFloat(e.nativeEvent.text) || 1)}
                    keyboardType="numeric"
                    style={{ backgroundColor: styles.bg.white5, color: styles.text.primary, borderColor: styles.border.subtle, borderWidth: 1 }}
                    className="px-4 py-2 rounded-xl font-manrope-bold text-sm w-24 text-right"
                  />
                  <Text style={{ color: styles.text.onSurfaceVariant40 }} className="text-[10px] font-manrope-medium ml-2">USD</Text>
                </View>
              </View>
            ))}
            <Text style={{ color: styles.text.onSurfaceVariant30 }} className="text-[10px] mt-4 italic text-center">
              Rates are used for real-time conversion during scans and rebase.
            </Text>
          </LuminousCard>
        </Animated.View>

        {/* Data Stewardship (Danger Zone) */}
        <Text className="text-error font-manrope-bold text-[10px] uppercase tracking-[0.2em] mb-4 ml-1">
          Data Stewardship
        </Text>
        <LuminousCard className="mb-8 overflow-hidden" style={{ borderColor: styles.border.error10, borderWidth: 1, backgroundColor: styles.bg.error5 }}>
          <Pressable 
            onPress={handleClearTransactions}
            className="flex-row items-center justify-between p-5 border-b border-error/10"
            android_ripple={{ color: styles.bg.white5 }}
          >
            <View className="flex-row items-center">
              <Database size={20} color={Colors.error} />
              <View className="ml-4">
                <Text style={{ color: styles.text.onSurface }} className="font-manrope-bold">Purge Transactions</Text>
                <Text className="text-error/60 text-xs text-xs">Keep settings, wipe data</Text>
              </View>
            </View>
            <ChevronRight size={20} color={Colors.error} opacity={0.5} />
          </Pressable>

          <Pressable 
            onPress={handleResetApp}
            className="flex-row items-center justify-between p-5"
            android_ripple={{ color: styles.bg.white5 }}
          >
            <View className="flex-row items-center">
              <AlertTriangle size={20} color={Colors.error} />
              <View className="ml-4">
                <Text style={{ color: styles.text.onSurface }} className="font-manrope-bold">Total App Reset</Text>
                <Text className="text-error/60 text-xs text-xs">Wipe everything permanently</Text>
              </View>
            </View>
            <ChevronRight size={20} color={Colors.error} opacity={0.5} />
          </Pressable>
        </LuminousCard>

        <View className="items-center mt-4 mb-20" style={{ opacity: 0.3 }}>
          <Text style={{ color: styles.text.onSurface }} className="font-manrope-bold text-xs tracking-tighter uppercase">PEACHSPEND v1.1.0-LUMINOUS</Text>
          <Text style={{ color: styles.text.onSurface }} className="font-manrope-medium text-[10px] mt-1 italic">"Crafted for the discerning minimalist"</Text>
        </View>

        {/* Currency Selection Modal */}
        <Modal visible={isCurrencyModalVisible} transparent animationType="slide">
          <View style={{ backgroundColor: styles.bg.overlay, flex: 1 }} className="justify-end">
            <View style={{ backgroundColor: colors.surfaceContainerHighest, borderTopColor: styles.border.card, borderTopWidth: 1 }} className="rounded-t-[40px] p-8">
              <View style={{ backgroundColor: styles.bg.white10 }} className="w-12 h-1.5 rounded-full self-center mb-8" />
              <Text style={{ color: styles.text.onSurface }} className="font-noto-serif-bold text-2xl mb-6">Select Currency</Text>
              <ScrollView showsVerticalScrollIndicator={false} className="max-h-[400px]">
                {CURRENCIES.map((c) => (
                  <TouchableOpacity
                    key={c}
                    onPress={() => handleCurrencySelect(c)}
                    style={{ borderBottomWidth: 1, borderBottomColor: styles.border.subtle }}
                    className="flex-row items-center justify-between py-5"
                  >
                    <Text style={{ color: styles.text.onSurface }} className="font-manrope-bold text-lg">{c}</Text>
                    {settings.currency === c && <Check size={20} color={Colors.primary} />}
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <TouchableOpacity
                onPress={() => setIsCurrencyModalVisible(false)}
                style={{ backgroundColor: styles.bg.white5, borderColor: styles.border.card, borderWidth: 1 }}
                className="mt-8 h-14 rounded-2xl items-center justify-center"
              >
                <Text style={{ color: styles.text.onSurface }} className="font-manrope-bold">Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* Conversion Confirmation Modal */}
        <CurrencyConversionModal
          visible={isConversionModalVisible}
          onClose={() => {
            setIsConversionModalVisible(false);
            setPendingCurrency(null);
          }}
          onConfirm={handleConversionConfirm}
          fromCurrency={settings.currency}
          toCurrency={pendingCurrency || ''}
          conversionRates={conversionRates}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
