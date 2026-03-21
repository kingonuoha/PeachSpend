export const Colors = {
  // Surfaces
  background:               '#131313',
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
  success:                  '#81C784',
  // Convenience aliases
  textSecondary:            '#D8C2BB', // onSurfaceVariant
  textTertiary:             '#A18C87', // outline
  'peach-500':              '#FFD2C4', // primary
} as const;

export const Spacing = { s1: 4, s2: 8, s3: 12, s4: 14, s5: 16, s6: 20, s7: 24, s8: 32, s9: 40, s10: 48, s12: 64 } as const;
export const Radii = { sm: 8, md: 12, lg: 20, xl: 28, full: 9999 } as const;

export const Typography = {
  displayLg:  { fontFamily: 'NotoSerif_700Bold',    fontSize: 48, lineHeight: 56 },
  displayMd:  { fontFamily: 'NotoSerif_700Bold',    fontSize: 36, lineHeight: 44 },
  headlineSm: { fontFamily: 'NotoSerif_400Regular', fontSize: 20, lineHeight: 28 },
  bodyMd:     { fontFamily: 'Manrope_400Regular',   fontSize: 14, lineHeight: 22 },
  labelMd:    { fontFamily: 'Manrope_500Medium',    fontSize: 12, lineHeight: 18 },
  labelLg:    { fontFamily: 'Manrope_600SemiBold',  fontSize: 14, lineHeight: 20 },
} as const;
