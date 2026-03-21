import React from 'react';
import { View, Text, FlatList, Image } from 'react-native';
import { Expense } from '../../types/database';
import { ExpenseItem } from './ExpenseItem';
import { Strings } from '../../constants/strings';

interface ExpenseListProps {
  expenses: Expense[];
  isLoading: boolean;
}

export const ExpenseList: React.FC<ExpenseListProps> = ({ expenses, isLoading }) => {
  if (isLoading) {
    return (
      <View className="py-8 items-center">
        <Text className="text-onSurfaceVariant font-manrope-regular">Loading expenses...</Text>
      </View>
    );
  }

  if (expenses.length === 0) {
    return (
      <View className="py-12 items-center px-8">
        <Image 
          source={require('../../assets/images/home-empty.png')}
          style={{ width: 200, height: 200, marginBottom: 24 }}
          resizeMode="contain"
        />
        <Text className="text-xl text-center text-onSurface font-noto-serif-bold mb-2">
          {Strings.home.no_expenses}
        </Text>
        <Text className="text-center text-onSurfaceVariant font-manrope-regular">
          Start by scanning a receipt to see your spending here.
        </Text>
      </View>
    );
  }

  return (
    <View className="flex-1">
      <Text className="text-xl text-onSurface font-noto-serif-bold mb-4 px-4">
        {Strings.home.recent_expenses}
      </Text>
      <FlatList
        data={expenses}
        renderItem={({ item }) => <ExpenseItem expense={item} />}
        keyExtractor={(item) => item.id}
        scrollEnabled={false} // Home is a scrollview overall
        contentContainerStyle={{ paddingHorizontal: 16 }}
      />
    </View>
  );
};
