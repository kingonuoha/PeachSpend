import { useMemo } from 'react';
import { useSettings } from '../components/ui/SettingsProvider';
import { DarkTheme, LightTheme, Colors } from '../constants/tokens';
import { buildThemePackState } from '../data/ThemePackContracts';

export function useTheme() {
  const { settings } = useSettings();
  const theme = settings.theme || 'dark';

  const themeColors = useMemo(() => {
    // Theme pack and light/dark are independent axes (FR-05.5). The pack contract
    // returns the palette for the active mode, so a pack swap recolors tokens
    // app-wide while leaving the light/dark selection untouched.
    const packPalette = buildThemePackState(settings.theme_pack, theme).palette;
    const palette = Object.keys(packPalette).length > 0 ? packPalette : theme === 'light' ? LightTheme : DarkTheme;
    return {
      ...Colors,
      ...palette,
    };
  }, [theme, settings.theme_pack]);

  return {
    theme,
    colors: themeColors,
    isDark: theme === 'dark',
  };
}
