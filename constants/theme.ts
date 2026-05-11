/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import { Platform } from 'react-native';

const tintColorLight = '#0a7ea4';
const tintColorDark = '#fff';

export const Colors = {
  light: {
    text: '#1F1B1A',
    background: '#FCF8F6',
    tint: '#FFD2C4',
    icon: '#85736E',
    tabIconDefault: '#85736E',
    tabIconSelected: '#FFD2C4',
  },
  dark: {
    text: '#E5E2E1',
    background: '#000000',
    tint: '#FFD2C4',
    icon: '#A18C87',
    tabIconDefault: '#A18C87',
    tabIconSelected: '#FFD2C4',
  },
  // Surfaces
  background:               '#000000', // True Black for OLED
  surface:                  '#131313',
  surfaceContainerLowest:   '#0E0E0E',
  surfaceContainerLow:      '#1C1B1B',
  surfaceContainerHigh:     '#2A2A2A',
  surfaceContainerHighest:  '#353534',
  // Primary (Peach)
  primary:                  '#FFD2C4',
  primaryContainer:         '#FFAB91',
  onPrimary:                '#793D29',
  onPrimaryContainer:       '#793D29',
  // Text
  onSurface:                '#E5E2E1',
  onSurfaceVariant:         '#D8C2BB',
  outline:                  '#A18C87',
  outlineVariant:           '#53433F',
  // Semantic
  error:                    '#CF6679',
  success:                  '#81C784',
} as const;

export const Spacing = { s1: 4, s2: 8, s3: 12, s4: 14, s5: 16, s6: 20, s7: 24, s8: 32, s9: 40, s10: 48, s12: 64 } as const;
export const Radii = { sm: 8, md: 12, lg: 20, xl: 28, full: 9999 } as const;

export const Typography = {
  displayLg:  { fontFamily: 'noto-serif-bold',    fontSize: 48, lineHeight: 56 },
  displayMd:  { fontFamily: 'noto-serif-bold',    fontSize: 36, lineHeight: 44 },
  headlineSm: { fontFamily: 'noto-serif-regular', fontSize: 20, lineHeight: 28 },
  bodyMd:     { fontFamily: 'manrope-regular',   fontSize: 14, lineHeight: 22 },
  labelMd:    { fontFamily: 'manrope-medium',    fontSize: 12, lineHeight: 18 },
  labelLg:    { fontFamily: 'manrope-semibold',  fontSize: 14, lineHeight: 20 },
} as const;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
