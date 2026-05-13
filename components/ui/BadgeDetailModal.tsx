import React from 'react';
import { View, Text, TouchableOpacity, Modal, Dimensions } from 'react-native';
import { BlurView } from 'expo-blur';
import { X, Check } from 'lucide-react-native';
import { Colors } from '../../constants/tokens';
import { useThemeStyles } from '../../hooks/useThemeStyles';

const { width } = Dimensions.get('window');

interface BadgeDetailModalProps {
  visible: boolean;
  badge: {
    id: string;
    label: string;
    description: string;
    icon: string;
    earned_at: number | null;
    current: number;
    target: number;
  } | null;
  onClose: () => void;
}

export function BadgeDetailModal({ visible, badge, onClose }: BadgeDetailModalProps) {
  const styles = useThemeStyles();
  if (!badge) return null;

  const earned = badge.earned_at !== null;
  const progress = badge.target > 0 ? Math.min(badge.current / badge.target, 1) : 0;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View className="flex-1 justify-end">
        <BlurView intensity={80} tint="dark" style={StyleSheet.absoluteFill} />
        <TouchableOpacity className="flex-1" activeOpacity={1} onPress={onClose} />
        <View className="bg-zinc-900 rounded-t-[40px] border-t border-white/10 px-8 pb-12 pt-8">
          <View className="flex-row justify-between items-center mb-6">
            <View className="w-8" />
            <Text style={{ color: styles.text.onSurface }} className="font-manrope-bold text-lg">Badge Details</Text>
            <TouchableOpacity onPress={onClose} className="p-1">
              <X size={22} color={styles.icon.muted} />
            </TouchableOpacity>
          </View>

          <View className="items-center mb-8">
            <View
              style={{
                backgroundColor: earned ? Colors.primary + '20' : 'rgba(255,255,255,0.05)',
                borderColor: earned ? Colors.primary + '30' : 'rgba(255,255,255,0.1)',
                borderWidth: 2,
                width: 96,
                height: 96,
                borderRadius: 32,
              }}
              className="items-center justify-center mb-5"
            >
              <Text style={{ fontSize: 44, opacity: earned ? 1 : 0.3 }}>{badge.icon}</Text>
            </View>

            {earned && (
              <View className="bg-green-500/20 px-4 py-1.5 rounded-full flex-row items-center mb-4">
                <Check size={14} color="#4ADE80" />
                <Text className="text-green-400 font-manrope-bold text-xs ml-1.5">Earned!</Text>
              </View>
            )}

            <Text style={{ color: styles.text.onSurface }} className="font-noto-serif-bold text-2xl mb-1">{badge.label}</Text>
            <Text style={{ color: styles.text.onSurfaceVariant }} className="font-manrope-medium text-base text-center leading-6">{badge.description}</Text>
          </View>

          {/* Progress Bar */}
          <View className="mb-6">
            <View className="flex-row justify-between items-center mb-2">
              <Text style={{ color: styles.text.onSurfaceVariant60 }} className="font-manrope-bold text-[10px] uppercase tracking-widest">Progress</Text>
              <Text style={{ color: styles.text.onSurface }} className="font-manrope-bold text-sm">
                {badge.current}/{badge.target}
              </Text>
            </View>
            <View style={{ backgroundColor: 'rgba(255,255,255,0.08)' }} className="w-full h-3 rounded-full overflow-hidden">
              <View
                style={{
                  width: `${progress * 100}%`,
                  backgroundColor: earned ? '#4ADE80' : Colors.primary,
                }}
                className="h-full rounded-full"
              />
            </View>
          </View>

          {earned && badge.earned_at && (
            <Text style={{ color: styles.text.onSurfaceVariant40 }} className="font-manrope-medium text-xs text-center">
              Earned on {new Date(badge.earned_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            </Text>
          )}

          {!earned && badge.current === 0 && (
            <Text style={{ color: styles.text.onSurfaceVariant40 }} className="font-manrope-medium text-xs text-center mt-1">
              No progress yet. {badge.description.toLowerCase()} to earn this badge.
            </Text>
          )}
        </View>
      </View>
    </Modal>
  );
}

const StyleSheet = {
  absoluteFill: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
};
