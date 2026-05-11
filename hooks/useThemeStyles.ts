import { useMemo } from 'react';
import { useTheme } from '../components/ui/ThemeProvider';

export function useThemeStyles() {
  const { colors, isDark } = useTheme();

  const surfaceContainerLowest = colors.surfaceContainerLowest;
  const surfaceContainerLow = colors.surfaceContainerLow;
  const surfaceContainerHigh = colors.surfaceContainerHigh;
  const surfaceContainerHighest = colors.surfaceContainerHighest;

  return useMemo(() => ({
    bg: {
      screen: colors.background,
      card: colors.surfaceContainerHigh,
      elevated: colors.surfaceContainerHighest,
      low: colors.surfaceContainerLow,
      lowest: colors.surfaceContainerLowest,
      surface: colors.surface,
      primary: colors.primary,
      primary5: colors.primary + '0D',
      primary10: colors.primary + '1A',
      primary20: colors.primary + '33',
      error5: colors.error + '0D',
      error10: colors.error + '1A',
      white5: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
      white10: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)',
      overlay: 'rgba(0,0,0,0.6)',
      surfaceContainerLowest,
      surfaceContainerLow,
      surfaceContainerHigh,
      surfaceContainerHighest,
    },

    text: {
      onSurface: colors.onSurface,
      onSurfaceVariant: colors.onSurfaceVariant,
      onSurfaceVariant60: colors.onSurfaceVariant + '99',
      onSurfaceVariant40: colors.onSurfaceVariant + '66',
      onSurfaceVariant30: colors.onSurfaceVariant + '4D',
      primary: colors.primary,
      primary60: colors.primary + '99',
      error: colors.error,
      error60: colors.error + '99',
      black: '#000000',
      white: '#FFFFFF',
    },

    border: {
      subtle: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)',
      card: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.12)',
      elevated: colors.outline + '1A',
      primary20: colors.primary + '33',
      error10: colors.error + '1A',
      error20: colors.error + '33',
    },

    icon: {
      default: colors.onSurface,
      muted: colors.onSurfaceVariant,
      primary: colors.primary,
      error: colors.error,
    },

    raw: colors,
  }), [colors, isDark, surfaceContainerLowest, surfaceContainerLow, surfaceContainerHigh, surfaceContainerHighest]);
}
