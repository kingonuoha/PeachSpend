import React from 'react';
import { View, ViewProps } from 'react-native';

interface LuminousCardProps extends ViewProps {
  children: React.ReactNode;
  variant?: 'low' | 'high' | 'highest';
  className?: string;
  containerStyle?: string;
}

export const LuminousCard: React.FC<LuminousCardProps> = ({
  children,
  variant = 'high',
  className = '',
  containerStyle = '',
  ...props
}) => {
  const backgroundVariants = {
    low: 'bg-surfaceContainerLow',
    high: 'bg-surfaceContainerHigh',
    highest: 'bg-surfaceContainerHighest',
  };

  return (
    <View
      className={`p-4 rounded-lg ${backgroundVariants[variant]} ${className} ${containerStyle}`}
      {...props}
    >
      {children}
    </View>
  );
};
