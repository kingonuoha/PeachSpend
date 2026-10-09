export const DarkTheme = {
  background: '#0F0B1E', surface: '#1C1730', surfaceContainerLowest: '#151027',
  surfaceContainerLow: '#1C1730', surfaceContainerHigh: '#241D3D', surfaceContainerHighest: '#2B2444',
  onSurface: '#F3F1F9', onSurfaceVariant: '#9C97AE', outline: '#2B2444',
  warning: '#FBBF24', warningContainer: '#3A2E10',
  // Duplicate-warning hairline (SH-04b) --warning-border dark value.
  warningBorder: '#523F16',
  // Warning tag foreground, the locked S-01 android-tag text. Dark reuses the
  // existing locked dark warning tone because the pair defines no dark override.
  warningContainerText: '#FBBF24',
  // S-04 currency-conversion banner. Dark values are the locked dark amber trio
  // (container, border, text) because the S-04 pair ships light only.
  conversionWarningBg: '#3A2E10', conversionWarningBorder: '#92400E', conversionWarningText: '#FBBF24',
  // SH-04a OCR high-confidence pill, sourced from the locked pair (code.html
  // line 228): emerald-950/70 container, emerald-800 border, emerald-300 text.
  successContainer: '#022C22', successBorder: '#065F46', successText: '#6EE7B7',
  // S-22 status chip pair (emerald-100 container, emerald-300 label, emerald-500
  // dot) from the locked S-22 pair (code.html lines 411-413, 526-528, 640-642).
  statusSuccessContainer: '#123324', statusSuccessText: '#34D399',
  // S-22 denied/paused chip label, the locked red-400 dark tone (code.html lines
  // 415-418, 530-533).
  dangerContainerText: '#F87171',
  // Dark counterpart of the canonical S-01 skip outline border (--purple-400).
  primaryBorder: '#A78BFA',
  textSecondary: '#9C97AE', textTertiary: '#9C97AE',
  primary: '#9163F5', primaryContainer: '#8B5CF6',
  purple100: '#2A1F52', danger: '#F87171', dangerSoft: '#3A1A1A',
  disabledBg: '#241D3D', disabledText: '#655E7A',
} as const;

export const LightTheme = {
  background: '#F7F7FB', surface: '#FFFFFF', surfaceContainerLowest: '#FFFFFF',
  surfaceContainerLow: '#F7F7FB', surfaceContainerHigh: '#FFFFFF', surfaceContainerHighest: '#ECECF3',
  onSurface: '#17162A', onSurfaceVariant: '#8B8B99', outline: '#ECECF2',
  warning: '#F59E0B', warningContainer: '#FEF3C7',
  // Duplicate-warning hairline (SH-04b) --warning-border light value.
  warningBorder: '#FDE68A',
  // Warning tag foreground from the locked S-01 android-tag rule (line 737).
  warningContainerText: '#92400E',
  // S-04 currency-conversion banner colors from the locked HTML (line 93).
  conversionWarningBg: '#FFFBEB', conversionWarningBorder: '#FCD34D', conversionWarningText: '#92400E',
  // SH-04a OCR high-confidence pill, sourced from the locked pair (code.html
  // line 228): emerald-50 container, emerald-200 border, emerald-700 text.
  successContainer: '#ECFDF5', successBorder: '#A7F3D0', successText: '#047857',
  // S-22 status chip pair (emerald-100 container, emerald-800 label) from the
  // locked S-22 pair (code.html lines 403-406, 518-521, 632-635).
  statusSuccessContainer: '#D1FAE5', statusSuccessText: '#065F46',
  // S-22 denied/paused chip label, the locked red-700 tone (code.html lines
  // 407-410, 522-525).
  dangerContainerText: '#B91C1C',
  // Canonical S-01 skip outline border (--purple-600).
  primaryBorder: '#7C3AED',
  textSecondary: '#8B8B99', textTertiary: '#8B8B99',
  primary: '#7C3AED', primaryContainer: '#8B5CF6',
  purple100: '#EDE9FE', danger: '#EF4444', dangerSoft: '#FEE2E2',
  disabledBg: '#ECECF3', disabledText: '#8B8B99', secondaryPressed: '#E2D9FD',
} as const;

export const Colors = {
   ...DarkTheme, onPrimary: '#FFFFFF',
   onPrimaryContainer: '#FFFFFF', error: '#EF4444', success: '#10B981', white: '#FFFFFF', black: '#17162A',
} as const;

export const Spacing = { s1: 4, s2: 8, s3: 12, s4: 16, s5: 20, s6: 24, s7: 32, s8: 40, s9: 48 } as const;
// xxl: 32px. Canonical conformance radius for the S-02 hero bottom edge and
// sheet top corners (code.html rounded-b-[32px] and rounded-t-[32px]).
export const Radii = { sm: 12, md: 16, lg: 20, xl: 28, xxl: 32, full: 9999 } as const;

export const Typography = {
  displayLg: { fontFamily: 'Manrope_700Bold', fontSize: 34, lineHeight: 39 },
  displayMd: { fontFamily: 'Manrope_700Bold', fontSize: 30, lineHeight: 36 },
  // Onboarding slide title, canonical S-01 26px w800 with tightened line height.
  headlineLg: { fontFamily: 'Manrope_700Bold', fontSize: 26, lineHeight: 32 },
  headlineSm: { fontFamily: 'Manrope_700Bold', fontSize: 22, lineHeight: 26 },
  bodyMd: { fontFamily: 'Manrope_500Medium', fontSize: 15, lineHeight: 21 },
  bodyBold: { fontFamily: 'Manrope_700Bold', fontSize: 15, lineHeight: 21 },
  labelBold: { fontFamily: 'Manrope_700Bold', fontSize: 14, lineHeight: 20 },
  captionBold: { fontFamily: 'Manrope_700Bold', fontSize: 13, lineHeight: 18 },
  headlineMd: { fontFamily: 'Manrope_700Bold', fontSize: 17, lineHeight: 22 },
  labelMd: { fontFamily: 'Manrope_400Regular', fontSize: 12, lineHeight: 16 },
  labelLg: { fontFamily: 'Manrope_600SemiBold', fontSize: 14, lineHeight: 20 },
  bodyRegular: { fontFamily: 'Manrope_400Regular', fontSize: 14, lineHeight: 20 },
  micro: { fontFamily: 'Manrope_500Medium', fontSize: 11, lineHeight: 13 },
  numpadKey: { fontFamily: 'Manrope_700Bold', fontSize: 22, lineHeight: 26 },
} as const;

export const Gradients = {
  light: ['#1E0B3D', '#4C1D95', '#7C3AED'],
  dark: ['#150A2E', '#3B1873', '#8B5CF6'],
} as const;

// Category tint pairs: [background, icon color]. Light pastel bg with a saturated
// icon, dark desaturated bg with a brighter icon, per design system section 1.
export const CategoryTints = {
  dining: { light: ['#FDE2E2', '#EF4444'], dark: ['#3A1A1A', '#F87171'] },
  groceries: { light: ['#D1FAE5', '#10B981'], dark: ['#123324', '#34D399'] },
  transport: { light: ['#DBEAFE', '#3B82F6'], dark: ['#122C4A', '#60A5FA'] },
  shopping: { light: ['#FCE7F3', '#EC4899'], dark: ['#3A1530', '#F472B6'] },
  entertainment: { light: ['#EDE9FE', '#7C3AED'], dark: ['#241A4D', '#A78BFA'] },
  // Health has no dedicated design-system pair. Background keeps the locked pair
  // value #E0F2FE, icon and dark pair use the nearest token pair (Transport blue).
  health: { light: ['#E0F2FE', '#3B82F6'], dark: ['#122C4A', '#60A5FA'] },
  utilities: { light: ['#FEF3C7', '#F59E0B'], dark: ['#3A2E10', '#FBBF24'] },
  other: { light: ['#F3F4F6', '#6B7280'], dark: ['#232232', '#9CA3AF'] },
} as const;
