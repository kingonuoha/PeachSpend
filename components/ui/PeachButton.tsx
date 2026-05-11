import React from 'react';
import { TouchableOpacity, Text, ActivityIndicator, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Colors } from '../../constants/tokens';

import { cssInterop } from 'react-native-css-interop';
import { useThemeStyles } from '../../hooks/useThemeStyles';

interface PeachButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  isLoading?: boolean;
  disabled?: boolean;
  className?: string;
  style?: any;
  icon?: React.ReactNode;
}

export const PeachButton: React.FC<PeachButtonProps> = ({
  title,
  onPress,
  variant = 'primary',
  isLoading = false,
  disabled = false,
  className = '',
  style,
  icon,
}) => {
  const ts = useThemeStyles();
  const handlePress = () => {
    if (!disabled && !isLoading) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onPress();
    }
  };

  const baseStyle = "py-4 px-8 rounded-full flex-row justify-center items-center active:scale-95";
  
  const variants: Record<string, { bg: string; text: string }> = {
    primary: { bg: Colors.primary, text: 'text-onPrimary font-manrope-bold' },
    secondary: { bg: ts.bg.card, text: 'text-onSurface font-manrope-semibold' },
    ghost: { bg: 'transparent', text: 'text-primary font-manrope-semibold' },
  };

  const v = variants[variant];
  const borderStyle = variant === 'ghost' ? { borderWidth: 1, borderColor: ts.border.card } : {};

  return (
    <TouchableOpacity
      onPress={handlePress}
      disabled={disabled || isLoading}
      activeOpacity={0.9}
      className={`${baseStyle} ${disabled ? 'opacity-40' : ''} ${className}`}
      style={[{ backgroundColor: v.bg }, borderStyle, style]}
    >
      {isLoading ? (
        <ActivityIndicator color={variant === 'primary' ? 'black' : Colors.primary} />
      ) : (
        <>
          {icon && <View className="mr-3">{icon}</View>}
          <Text className={`text-base tracking-tight ${v.text}`}>
            {title}
          </Text>
        </>
      )}
    </TouchableOpacity>
  );
};

cssInterop(PeachButton, {
  className: 'style',
});
