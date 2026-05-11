import React, { useEffect, useState, useRef } from 'react';
import { View, Text, TouchableOpacity, ScrollView, FlatList, Dimensions, Image, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { X, Calendar, Tag, Store, CreditCard, Share2, Trash2, Edit3 } from 'lucide-react-native';
import { databaseService } from '../../services/DatabaseService';
import { useTheme } from '../../components/ui/ThemeProvider';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import { useSettings } from '../../components/ui/SettingsProvider';
import { useExpenses } from '../../hooks/useExpenses';
import { Expense } from '../../types/database';
import { format } from 'date-fns';
import { LuminousCard } from '../../components/ui/LuminousCard';
import * as Haptics from 'expo-haptics';
import Animated, { FadeIn } from 'react-native-reanimated';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function ExpenseDetailScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useThemeStyles();
  const { expenses, refreshExpenses } = useExpenses();
  const [initialIndex, setInitialIndex] = useState<number | null>(null);
  
  // Find the index of the selected expense
  useEffect(() => {
    if (expenses.length > 0 && id) {
      const index = expenses.findIndex(e => e.id === id);
      if (index !== -1) {
        setInitialIndex(index);
      }
    }
  }, [expenses, id]);

  const handleDelete = async (expenseId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    await databaseService.deleteExpense(expenseId);
    await refreshExpenses();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    
    // If it was the last one, go back, otherwise the list handles it
    if (expenses.length <= 1) {
      router.replace('/(tabs)');
    }
  };

  if (initialIndex === null) {
     return <View style={{ backgroundColor: styles.bg.screen, flex: 1 }} />;
  }

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: colors.background }}>
      <View style={{ borderBottomColor: styles.border.subtle, borderBottomWidth: 1 }} className="px-6 py-4 flex-row justify-between items-center">
        <TouchableOpacity 
          onPress={() => router.back()}
          style={{ backgroundColor: styles.bg.white5 }}
          className="p-3 rounded-2xl"
        >
          <X color={styles.icon.default} size={20} />
        </TouchableOpacity>
        <Text style={{ color: styles.text.onSurface }} className="font-manrope-bold text-lg">Transaction Detail</Text>
        <TouchableOpacity style={{ backgroundColor: styles.bg.white5 }} className="p-3 rounded-2xl">
          <Share2 color={styles.icon.default} size={20} />
        </TouchableOpacity>
      </View>

      <FlatList
        data={expenses}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        initialScrollIndex={initialIndex}
        getItemLayout={(_, index) => ({
          length: SCREEN_WIDTH,
          offset: SCREEN_WIDTH * index,
          index,
        })}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <ExpenseDetailItem 
            expense={item} 
            onDelete={() => handleDelete(item.id)} 
          />
        )}
        windowSize={3}
        removeClippedSubviews={Platform.OS === 'android'}
      />
    </SafeAreaView>
  );
}

function ExpenseDetailItem({ expense, onDelete }: { expense: Expense, onDelete: () => void }) {
  const { colors } = useTheme();
  const styles = useThemeStyles();
  const { settings, getCurrencySymbol, convertAmount } = useSettings();
  const pricesVisible = settings.prices_visible !== 'false';

  const dateStr = format(new Date(expense.created_at), 'MMMM dd, yyyy');
  const timeStr = format(new Date(expense.created_at), 'HH:mm');
  const displayValue = convertAmount(expense.amount, expense.currency || 'USD');

  return (
    <ScrollView 
      style={{ width: SCREEN_WIDTH }}
      className="flex-1 px-6" 
      contentContainerStyle={{ paddingTop: 32, paddingBottom: 40 }}
    >
      <Animated.View entering={FadeIn.duration(400)}>
        {/* Main Amount Card */}
        <View className="items-center mb-10">
          <View className="bg-primary/10 px-4 py-2 rounded-full mb-4 border border-primary/20">
            <Text className="text-primary font-manrope-bold text-xs uppercase tracking-widest">{expense.category}</Text>
          </View>
          <View className="flex-row items-baseline">
            {pricesVisible && <Text className="text-primary font-noto-serif-bold text-3xl mr-2">{displayValue.symbol}</Text>}
            <Text style={{ color: styles.text.onSurface }} className="font-noto-serif-bold text-6xl tracking-tighter">
              {pricesVisible ? displayValue.amount.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '••••'}
            </Text>
          </View>
          <Text className="text-onSurfaceVariant/60 font-manrope-medium mt-4 text-base">
            Spent at {expense.merchant}
          </Text>
        </View>

        {/* Receipt Image */}
        {expense.image_uri && (
          <View style={{ borderColor: styles.border.card, borderWidth: 1 }} className="mb-8 rounded-3xl overflow-hidden">
            <Image
              source={{ uri: expense.image_uri }}
              style={{ width: '100%', height: 250, backgroundColor: styles.bg.screen }}
              resizeMode="contain"
            />
          </View>
        )}

        {/* Details List */}
        <LuminousCard className="p-6 mb-8" style={{ borderColor: styles.border.subtle, borderWidth: 1 }}>
          <DetailRow 
            icon={<Store size={20} color={colors.onSurfaceVariant} />} 
            label="Merchant" 
            value={expense.merchant} 
          />
          <DetailRow 
            icon={<Tag size={20} color={colors.onSurfaceVariant} />} 
            label="Category" 
            value={expense.category} 
            isCapitalized
          />
          <DetailRow 
            icon={<Calendar size={20} color={colors.onSurfaceVariant} />} 
            label="Date & Time" 
            value={`${dateStr} • ${timeStr}`} 
          />
          <DetailRow 
            icon={<CreditCard size={20} color={colors.onSurfaceVariant} />} 
            label="Original Value" 
            value={`${expense.amount.toFixed(2)} ${expense.currency || 'USD'}`} 
          />
          {expense.note && (
            <DetailRow 
              icon={<Edit3 size={20} color={colors.onSurfaceVariant} />} 
              label="Item Name" 
              value={expense.note} 
              isLast
            />
          )}
        </LuminousCard>

        {/* Actions */}
        <TouchableOpacity 
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            onDelete();
          }}
          style={{ backgroundColor: styles.bg.error5, borderColor: styles.border.error20, borderWidth: 1 }}
          className="py-5 rounded-[24px] flex-row items-center justify-center"
        >
          <Trash2 color={styles.icon.error} size={20} />
          <Text style={{ color: styles.text.error }} className="font-manrope-bold ml-3 text-base">Delete Record</Text>
        </TouchableOpacity>
      </Animated.View>
    </ScrollView>
  );
}

function DetailRow({ icon, label, value, isCapitalized, isLast }: any) {
  const styles = useThemeStyles();
  return (
    <View style={{ borderBottomWidth: isLast ? 0 : 1, borderBottomColor: styles.border.subtle }} className="flex-row items-center py-4">
      <View style={{ backgroundColor: styles.bg.white5 }} className="p-3 rounded-xl mr-4">
        {icon}
      </View>
      <View className="flex-1">
        <Text style={{ color: styles.text.onSurfaceVariant40 }} className="font-manrope-medium text-xs uppercase tracking-widest">{label}</Text>
        <Text style={{ color: styles.text.onSurface }} className={`font-manrope-bold text-base mt-0.5 ${isCapitalized ? 'capitalize' : ''}`}>
          {value}
        </Text>
      </View>
    </View>
  );
}
