import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { X, Plus, Trash2, RefreshCw } from 'lucide-react-native';
import { Colors } from '../../constants/tokens';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import { databaseService } from '../../services/DatabaseService';
import { format } from 'date-fns';
import * as Haptics from 'expo-haptics';

export default function RecurringScreen() {
  const router = useRouter();
  const ts = useThemeStyles();
  const [templates, setTemplates] = useState<any[]>([]);

  useEffect(() => {
    loadTemplates();
  }, []);

  const loadTemplates = async () => {
    const data = await databaseService.getRecurringTemplates('expense');
    setTemplates(data);
  };

  const handleDelete = (id: string) => {
    Alert.alert('Delete Template', 'Are you sure you want to delete this recurring expense?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        await databaseService.deleteRecurringTemplate(id);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        loadTemplates();
      }},
    ]);
  };

  const getIntervalLabel = (template: any) => {
    if (template.interval === 'daily') return 'Daily';
    if (template.interval === 'weekly') return 'Weekly';
    if (template.interval === 'monthly') return 'Monthly';
    if (template.interval === 'custom' && template.recurrence_days) {
      try {
        const days: number[] = JSON.parse(template.recurrence_days);
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        return days.map((d: number) => dayNames[d]).join(', ');
      } catch { return 'Custom'; }
    }
    return template.interval;
  };

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: ts.bg.screen }}>
      <View className="flex-row justify-between items-center px-6 py-4">
        <TouchableOpacity onPress={() => router.back()} style={{ backgroundColor: ts.bg.white5 }} className="p-3 rounded-2xl">
          <X color={ts.icon.default} size={20} />
        </TouchableOpacity>
        <Text style={{ color: ts.text.onSurface }} className="font-manrope-bold text-lg">Recurring</Text>
        <View className="w-10" />
      </View>

      <ScrollView className="flex-1 px-6" contentContainerStyle={{ paddingBottom: 40 }}>
        {templates.length === 0 ? (
          <View className="flex-1 items-center justify-center pt-20">
            <View style={{ backgroundColor: Colors.primary + '10' }} className="w-20 h-20 rounded-[30px] items-center justify-center mb-6">
              <RefreshCw size={32} color={Colors.primary} />
            </View>
            <Text style={{ color: ts.text.onSurface }} className="font-noto-serif-bold text-2xl text-center mb-2">No Recurring Expenses</Text>
            <Text style={{ color: ts.text.onSurfaceVariant60 }} className="font-manrope-medium text-sm text-center leading-5 px-8">
              Tap "Repeats" when adding an expense to set up recurring payments.
            </Text>
          </View>
        ) : (
          templates.map((t) => (
            <View key={t.id} style={{ backgroundColor: ts.bg.white5, borderColor: ts.border.subtle, borderWidth: 1 }} className="mb-3 p-5 rounded-3xl">
              <View className="flex-row justify-between items-start">
                <View className="flex-1 mr-4">
                  <Text style={{ color: ts.text.onSurface }} className="font-manrope-bold text-lg">{t.merchant}</Text>
                  <View className="flex-row items-center mt-1">
                    <View style={{ backgroundColor: Colors.primary + '20' }} className="px-3 py-1 rounded-full">
                      <Text className="text-primary font-manrope-bold text-[10px] uppercase tracking-wider">{getIntervalLabel(t)}</Text>
                    </View>
                  </View>
                </View>
                <Text style={{ color: Colors.primary }} className="font-noto-serif-bold text-2xl">
                  {t.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })} {t.currency}
                </Text>
              </View>
              <View className="flex-row justify-between items-center mt-4 pt-4" style={{ borderTopColor: ts.border.subtle, borderTopWidth: 1 }}>
                <View>
                  <Text style={{ color: ts.text.onSurfaceVariant40 }} className="font-manrope-medium text-[10px] uppercase tracking-widest">Next Due</Text>
                  <Text style={{ color: ts.text.onSurface }} className="font-manrope-bold text-sm mt-0.5">
                    {format(new Date(t.next_due_date), 'MMM dd, yyyy')}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => handleDelete(t.id)} style={{ backgroundColor: 'rgba(255,138,128,0.1)' }} className="p-3 rounded-xl">
                  <Trash2 color="#FF8A80" size={16} />
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}