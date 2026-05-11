import React, { useState, useEffect } from 'react';
import { View, Text, Modal, TextInput, TouchableOpacity } from 'react-native';
import { Colors } from '../../constants/tokens';
import { PeachButton } from '../ui/PeachButton';
import { RefreshCcw, TrendingUp } from 'lucide-react-native';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import * as Haptics from 'expo-haptics';

interface CurrencyConversionModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: (rate: number) => void;
  fromCurrency: string;
  toCurrency: string;
  conversionRates: Record<string, number>;
}

export function CurrencyConversionModal({
  visible,
  onClose,
  onConfirm,
  fromCurrency,
  toCurrency,
  conversionRates
}: CurrencyConversionModalProps) {
  const ts = useThemeStyles();
  const deriveRate = () => {
    const fromRate = conversionRates[fromCurrency] || 1;
    const toRate = conversionRates[toCurrency] || 1;
    return (fromRate / toRate).toFixed(4);
  };

  const [rate, setRate] = useState('1.0');
  const [isCalculating, setIsCalculating] = useState(false);

  useEffect(() => {
    if (visible) {
      setIsCalculating(true);
      const timer = setTimeout(() => {
        setIsCalculating(false);
        setRate(deriveRate());
      }, 600);
      return () => clearTimeout(timer);
    }
  }, [visible, fromCurrency, toCurrency, conversionRates]);

  const handleConfirm = () => {
    const numericRate = parseFloat(rate);
    if (isNaN(numericRate) || numericRate <= 0) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    onConfirm(numericRate);
  };

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View className="flex-1 justify-center items-center px-6" style={{ backgroundColor: ts.bg.overlay }}>
        <View style={{ backgroundColor: ts.bg.surfaceContainerHighest, borderColor: ts.border.card, borderWidth: 1 }} className="w-full rounded-[32px] p-8 shadow-2xl">
          <View className="bg-primary/10 w-16 h-16 rounded-full items-center justify-center self-center mb-6">
            <RefreshCcw size={32} color={Colors.primary} />
          </View>

          <Text style={{ color: ts.text.onSurface }} className="font-noto-serif-bold text-2xl text-center mb-2">
            Currency Metamorphosis
          </Text>
          <Text className="text-onSurfaceVariant text-center mb-8 px-4 leading-5">
            You are switching from <Text className="text-primary font-manrope-bold">{fromCurrency}</Text> to <Text className="text-primary font-manrope-bold">{toCurrency}</Text>. Existing metadata remains intact.
          </Text>

          <View style={{ backgroundColor: ts.bg.white5, borderColor: ts.border.subtle, borderWidth: 1 }} className="rounded-2xl p-6 mb-8">
            <View className="flex-row justify-between items-center mb-4">
              <Text className="text-onSurfaceVariant font-manrope-bold text-[10px] uppercase tracking-widest">
                Conversion Rate
              </Text>
              {isCalculating && (
                <View className="animate-pulse">
                  <TrendingUp size={14} color={Colors.primary} />
                </View>
              )}
            </View>
            
            <View className="flex-row items-center border-b border-primary/30 pb-2">
              <Text style={{ color: ts.text.onSurface }} className="font-noto-serif-bold text-3xl mr-3">1 {fromCurrency} =</Text>
              <TextInput
                value={rate}
                onChangeText={setRate}
                keyboardType="numeric"
                className="text-primary font-noto-serif-bold text-3xl flex-1"
                placeholder="1.0"
                placeholderTextColor={Colors.onSurfaceVariant}
              />
              <Text style={{ color: ts.text.onSurface }} className="font-noto-serif-bold text-xl ml-2">{toCurrency}</Text>
            </View>
            <Text className="text-onSurfaceVariant/40 text-[10px] mt-3 italic">
              * Live parity detected via Luminous Flow.
            </Text>
          </View>

          <View className="flex-row gap-4">
            <TouchableOpacity 
              onPress={onClose}
              style={{ borderColor: ts.border.card, borderWidth: 1 }}
              className="flex-1 h-14 rounded-2xl items-center justify-center"
            >
              <Text style={{ color: ts.text.onSurface }} className="font-manrope-bold">Keep {fromCurrency}</Text>
            </TouchableOpacity>
            
            <PeachButton
              title="Apply Change"
              onPress={handleConfirm}
              className="flex-1 h-14"
              variant="primary"
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}
