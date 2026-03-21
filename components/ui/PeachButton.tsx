import React from 'react';
import { TouchableOpacity, Text, ActivityIndicator, View } from 'react-native';
import { Colors } from '../../constants/tokens';

interface PeachButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  isLoading?: boolean;
  disabled?: boolean;
  className?: string;
  icon?: React.ReactNode;
}

export const PeachButton: React.FC<PeachButtonProps> = ({
  title,
  onPress,
  variant = 'primary',
  isLoading = false,
  disabled = false,
  className = '',
  icon,
}) => {
  const baseStyle = "py-4 px-6 rounded-md flex-row justify-center items-center";
  
  const variants = {
    primary: "bg-primary",
    secondary: "bg-surfaceContainerHigh",
    ghost: "bg-transparent border border-outlineVariant",
  };

  const textVariants = {
    primary: "text-onPrimary font-manrope-semibold",
    secondary: "text-onSurface font-manrope-medium",
    ghost: "text-primary font-manrope-medium",
  };

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || isLoading}
      activeOpacity={0.8}
      className={`${baseStyle} ${variants[variant]} ${disabled ? 'opacity-50' : ''} ${className}`}
    >
      {isLoading ? (
        <ActivityIndicator color={variant === 'primary' ? Colors.onPrimary : Colors.primary} />
      ) : (
        <>
          {icon && <View className="mr-2">{icon}</View>}
          <Text className={`text-base ${textVariants[variant]}`}>
            {title}
          </Text>
        </>
      )}
    </TouchableOpacity>
  );
};
