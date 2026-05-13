import React from 'react';
import { View, Text, TouchableOpacity, Modal, Pressable } from 'react-native';
import { AlertTriangle, X } from 'lucide-react-native';
import { Colors } from '../../constants/tokens';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import { Expense } from '../../types/database';
import { format } from 'date-fns';

interface DuplicateWarningModalProps {
  visible: boolean;
  existingExpense: Expense | null;
  onSaveAnyway: () => void;
  onDiscard: () => void;
}

export const DuplicateWarningModal: React.FC<DuplicateWarningModalProps> = ({
  visible,
  existingExpense,
  onSaveAnyway,
  onDiscard,
}) => {
  const ts = useThemeStyles();

  if (!existingExpense) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDiscard}>
      <View className="flex-1 items-center justify-center px-8 bg-black/60">
        <View style={{ backgroundColor: ts.bg.surfaceContainerHighest, borderColor: ts.border.card, borderWidth: 1 }} className="w-full p-8 rounded-[40px]">
          <View className="items-center mb-6">
            <View className="w-16 h-16 bg-yellow-500/10 rounded-[24px] items-center justify-center mb-4">
              <AlertTriangle size={32} color="#FBBF24" />
            </View>
            <Text style={{ color: ts.text.onSurface }} className="font-noto-serif-bold text-2xl text-center">Possible Duplicate</Text>
            <Text style={{ color: ts.text.onSurfaceVariant60 }} className="font-manrope-medium text-sm text-center mt-2 leading-5">
              An expense with the same merchant and amount was found within the last 24 hours.
            </Text>
          </View>

          <View style={{ backgroundColor: ts.bg.white5, borderColor: ts.border.subtle, borderWidth: 1 }} className="p-5 rounded-3xl mb-6">
            <Text style={{ color: ts.text.onSurfaceVariant40 }} className="font-manrope-bold text-[10px] uppercase tracking-widest mb-2">EXISTING EXPENSE</Text>
            <Text style={{ color: ts.text.onSurface }} className="font-manrope-bold text-lg">{existingExpense.merchant}</Text>
            <Text style={{ color: Colors.primary }} className="font-noto-serif-bold text-2xl mt-1">
              {existingExpense.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {existingExpense.currency}
            </Text>
            <Text style={{ color: ts.text.onSurfaceVariant60 }} className="font-manrope-medium text-xs mt-1">
              {format(new Date(existingExpense.created_at), 'MMM dd, yyyy • HH:mm')}
            </Text>
          </View>

          <TouchableOpacity
            onPress={onSaveAnyway}
            className="bg-primary py-4 rounded-2xl items-center mb-3"
          >
            <Text className="text-black font-manrope-bold text-base">Save Anyway</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={onDiscard}
            style={{ backgroundColor: ts.bg.white5, borderColor: ts.border.subtle, borderWidth: 1 }}
            className="py-4 rounded-2xl items-center"
          >
            <Text style={{ color: ts.text.onSurface }} className="font-manrope-bold text-base">Discard</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};