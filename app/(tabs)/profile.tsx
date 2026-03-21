import React from 'react';
import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useExpenses } from '../../hooks/useExpenses';
import { Colors } from '../../constants/tokens';
import { LuminousCard } from '../../components/ui/LuminousCard';
import { User, ShieldCheck, Zap } from 'lucide-react-native';

export default function ProfileScreen() {
  const { expenses } = useExpenses();
  
  const totalSpent = expenses.reduce((sum, exp) => sum + exp.amount, 0);
  const scannedCount = expenses.filter(e => e.scanned).length;

  return (
    <SafeAreaView className="flex-1 bg-black" edges={['top']}>
      <ScrollView className="flex-1 px-6 pt-4">
        {/* Profile Header */}
        <View className="items-center mb-8">
          <View className="w-24 h-24 rounded-full bg-surfaceContainerHigh items-center justify-center mb-4 border-2 border-primary/20">
            <User size={48} color={Colors.primary} />
          </View>
          <Text className="text-white text-2xl font-manrope-bold">Kingsley</Text>
          <Text className="text-textSecondary font-manrope-medium">kingsley@peachspend.app</Text>
        </View>

        {/* Stats Grid */}
        <View className="flex-row justify-between mb-8">
          <LuminousCard containerStyle="flex-1 mr-2 p-4 items-center">
            <Text className="text-textSecondary text-xs uppercase tracking-widest font-manrope-semibold mb-1">Tracked</Text>
            <Text className="text-white text-xl font-manrope-bold">${totalSpent.toFixed(0)}</Text>
          </LuminousCard>
          <LuminousCard containerStyle="flex-1 ml-2 p-4 items-center">
            <Text className="text-textSecondary text-xs uppercase tracking-widest font-manrope-semibold mb-1">Scanned</Text>
            <Text className="text-white text-xl font-manrope-bold">{scannedCount}</Text>
          </LuminousCard>
        </View>

        {/* Lifetime Activity */}
        <Text className="text-white text-lg font-manrope-bold mb-4">Account Health</Text>
        
        <LuminousCard containerStyle="mb-4 p-4 flex-row items-center">
          <View className="bg-success/20 p-2 rounded-xl mr-4">
            <ShieldCheck size={20} color={Colors.success} />
          </View>
          <View className="flex-1">
            <Text className="text-white font-manrope-semibold">Data Secure</Text>
            <Text className="text-textSecondary text-xs">All expenses stored locally on device.</Text>
          </View>
        </LuminousCard>

        <LuminousCard containerStyle="mb-8 p-4 flex-row items-center">
          <View className="bg-primary/20 p-2 rounded-xl mr-4">
            <Zap size={20} color={Colors.primary} />
          </View>
          <View className="flex-1">
            <Text className="text-white font-manrope-semibold">AI Efficiency</Text>
            <Text className="text-textSecondary text-xs">Gemini AI is processing your receipts.</Text>
          </View>
        </LuminousCard>
      </ScrollView>
    </SafeAreaView>
  );
}
