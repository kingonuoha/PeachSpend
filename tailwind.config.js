/** @type {import('tailwindcss').Config} */
module.exports = {
  // NOTE: Update this to include the paths to all of your component files.
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
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
        // Semantic
        error:                    '#CF6679',
        success:                  '#81C784',
      },
      fontFamily: {
        'noto-serif-bold': ['NotoSerif_700Bold'],
        'noto-serif-regular': ['NotoSerif_400Regular'],
        'manrope-regular': ['Manrope_400Regular'],
        'manrope-medium': ['Manrope_500Medium'],
        'manrope-semibold': ['Manrope_600SemiBold'],
      },
      borderRadius: {
        'sm': '8px',
        'md': '12px',
        'lg': '20px',
        'xl': '28px',
      }
    },
  },
  plugins: [],
}
