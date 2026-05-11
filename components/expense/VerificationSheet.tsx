import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView, TextInput, StyleSheet, Dimensions, Pressable } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, withSpring, Easing } from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { Check, X, Plus, Trash2, AlertCircle } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../../constants/tokens';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import { ScannedReceipt } from '../../types/gemini';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

interface VerificationSheetProps {
  isVisible: boolean;
  data: ScannedReceipt | ScannedReceipt[] | null | unknown;
  onConfirm: (data: ScannedReceipt[]) => void;
  onCancel: () => void;
}

export const VerificationSheet: React.FC<VerificationSheetProps> = ({
  isVisible,
  data,
  onConfirm,
  onCancel,
}) => {
  const ts = useThemeStyles();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<ScannedReceipt[]>([]);
  const overlayOpacity = useSharedValue(0);
  const sheetTranslate = useSharedValue(SCREEN_HEIGHT);

  useEffect(() => {
    if (isVisible) {
      if (data) {
        setItems(Array.isArray(data) ? [...data] : [data as ScannedReceipt]);
      }
      overlayOpacity.value = withTiming(1, { duration: 250 });
      sheetTranslate.value = withSpring(0, { damping: 20, mass: 1, stiffness: 200 });
    } else {
      overlayOpacity.value = withTiming(0, { duration: 200 });
      sheetTranslate.value = withTiming(SCREEN_HEIGHT, { duration: 200, easing: Easing.in(Easing.cubic) });
    }
  }, [isVisible, data]);

  const overlayStyle = useAnimatedStyle(() => ({
    opacity: overlayOpacity.value,
  }));

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: sheetTranslate.value }],
  }));

  const updateItem = (index: number, field: keyof ScannedReceipt, value: any) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], [field]: value };
    setItems(newItems);
  };

  const removeItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const addItem = () => {
    setItems([...items, { 
      merchant: items[0]?.merchant || 'Unknown', 
      note: '', 
      amount: 0, 
      category: 'other',
      currency: items[0]?.currency || 'USD',
      confidence: 1.0
    }]);
  };

  if (!isVisible && items.length === 0) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={isVisible ? 'auto' : 'none'} className="z-50">
      <Animated.View style={[overlayStyle]} className="absolute inset-0 bg-black/60">
        <Pressable className="flex-1" onPress={onCancel} />
      </Animated.View>
      
      <Animated.View 
        style={[sheetStyle, { height: SCREEN_HEIGHT * 0.8, backgroundColor: ts.bg.surfaceContainerHighest, borderTopColor: ts.border.card, borderTopWidth: 1 }]}
        className="absolute bottom-0 w-full rounded-t-[40px] overflow-hidden"
      >
        <BlurView intensity={80} tint="dark" style={StyleSheet.absoluteFill} />
        
        <View className="flex-1 p-6">
          <View className="flex-row justify-between items-center mb-6">
            <View>
              <Text style={{ color: ts.text.onSurface }} className="font-manrope-bold text-2xl">Verify Items</Text>
              <Text style={{ color: ts.text.onSurfaceVariant40 }} className="text-xs font-manrope-medium mt-1">
                {items.length} item{items.length !== 1 ? 's' : ''} detected
              </Text>
            </View>
            <TouchableOpacity 
              onPress={onCancel}
              style={{ backgroundColor: ts.bg.white5, borderColor: ts.border.card, borderWidth: 1 }}
              className="p-2 rounded-full"
            >
              <X color={ts.icon.default} size={20} />
            </TouchableOpacity>
          </View>

          <ScrollView 
            showsVerticalScrollIndicator={false} 
            contentContainerStyle={{ paddingBottom: insets.bottom + 140 }}
            className="flex-1"
          >
            {items.map((item, index) => (
              <View key={index} style={{ backgroundColor: ts.bg.white5, borderColor: ts.border.subtle, borderWidth: 1 }} className="mb-4 p-4 rounded-3xl">
                <View className="flex-row justify-between items-center mb-3">
                  <View className="flex-row items-center">
                    <View className="w-6 h-6 rounded-full bg-primary/20 items-center justify-center mr-2">
                      <Text className="text-primary text-[10px] font-manrope-bold">{index + 1}</Text>
                    </View>
                    <TextInput
                      value={item.note || ''}
                      onChangeText={(v) => updateItem(index, 'note', v)}
                      style={{ color: ts.text.onSurface, width: SCREEN_HEIGHT * 0.2 }}
                      className="font-manrope-semibold text-sm"
                      placeholder="Item name..."
                      placeholderTextColor={ts.text.onSurfaceVariant60}
                    />
                  </View>
                  <TouchableOpacity onPress={() => removeItem(index)}>
                    <Trash2 color="#F87171" size={16} />
                  </TouchableOpacity>
                </View>

                <View style={{ borderTopColor: ts.border.subtle, borderTopWidth: 1 }} className="flex-row items-center pt-3">
                  <View className="flex-1">
                    <Text style={{ color: ts.text.onSurfaceVariant40 }} className="text-[10px] uppercase font-manrope-bold tracking-widest mb-1">Price</Text>
                    <View className="flex-row items-center">
                      <Text className="text-primary font-manrope-bold text-lg mr-1">{item.currency === 'USD' ? '$' : item.currency === 'EUR' ? '€' : '₦'}</Text>
                      <TextInput
                        value={item.amount?.toString()}
                        onChangeText={(v) => updateItem(index, 'amount', parseFloat(v) || 0)}
                        keyboardType="numeric"
                        style={{ color: ts.text.onSurface }}
                        className="font-manrope-bold text-xl p-0"
                      />
                    </View>
                  </View>
                  <View className="flex-1 items-end">
                    <Text style={{ color: ts.text.onSurfaceVariant40 }} className="text-[10px] uppercase font-manrope-bold tracking-widest mb-1">Category</Text>
                    <TouchableOpacity style={{ backgroundColor: ts.bg.white5, borderColor: ts.border.subtle, borderWidth: 1 }} className="px-3 py-1 rounded-full">
                      <Text className="text-primary text-xs font-manrope-bold capitalize">{item.category}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            ))}

            <TouchableOpacity 
              onPress={addItem}
              style={{ borderColor: ts.border.card, borderWidth: 2, borderStyle: 'dashed' }}
              className="flex-row items-center justify-center p-5 rounded-3xl mb-4"
            >
              <Plus color={Colors.primary} size={18} className="mr-2" />
              <Text style={{ color: ts.text.onSurfaceVariant60 }} className="font-manrope-semibold text-sm">Add Item</Text>
            </TouchableOpacity>

            <View className="bg-primary/5 p-4 rounded-2xl flex-row items-start border border-primary/10">
              <AlertCircle size={16} color={Colors.primary} className="mt-0.5" />
              <Text style={{ color: ts.text.onSurfaceVariant60 }} className="text-[10px] font-manrope-medium ml-2 flex-1">
                Total: ${items.reduce((sum, i) => sum + (i.amount || 0), 0).toFixed(2)}. Each approved item will be added as a separate expense.
              </Text>
            </View>
          </ScrollView>
        </View>

        <View style={{ backgroundColor: ts.bg.surfaceContainerHighest, borderTopColor: ts.border.subtle, borderTopWidth: 1, paddingBottom: insets.bottom + 100 }} className="absolute bottom-0 w-full p-6">
          <TouchableOpacity
            onPress={() => onConfirm(items)}
            className="bg-primary w-full py-4 rounded-2xl flex-row items-center justify-center shadow-lg shadow-primary/20"
          >
            <Check color="#000" size={20} className="mr-2" />
            <Text className="text-black font-manrope-bold text-base">
              Process {items.length} Expense{items.length !== 1 ? 's' : ''}
            </Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </View>
  );
};
