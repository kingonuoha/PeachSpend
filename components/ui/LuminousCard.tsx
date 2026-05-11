import React from 'react';
import { View, ViewProps } from 'react-native';

import { cssInterop } from 'react-native-css-interop';
import { useThemeStyles } from '../../hooks/useThemeStyles';

interface LuminousCardProps extends ViewProps {
  children: React.ReactNode;
  variant?: 'low' | 'high' | 'highest';
  className?: string;
}

export const LuminousCard: React.FC<LuminousCardProps> = ({
  children,
  variant = 'high',
  className = '',
  style,
  ...props
}) => {
  const ts = useThemeStyles();

  const backgroundVariants = {
    low: ts.bg.low,
    high: ts.bg.card,
    highest: ts.bg.elevated,
  };

  return (
    <View
      className={`p-5 rounded-2xl overflow-hidden ${className}`}
      style={[{ backgroundColor: backgroundVariants[variant] }, style]}
      {...props}
    >
      {children}
    </View>
  );
};

cssInterop(LuminousCard, {
  className: 'style',
});
