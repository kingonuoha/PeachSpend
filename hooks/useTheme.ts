import { useMemo } from 'react';
import { useSettings } from '../components/ui/SettingsProvider';
import { DarkTheme, LightTheme, Colors } from '../constants/tokens';

export function useTheme() {
  const { settings } = useSettings();
  const theme = settings.theme || 'dark';

  const themeColors = useMemo(() => {
    const palette = theme === 'light' ? LightTheme : DarkTheme;
    return {
      ...Colors,
      ...palette,
    };
  }, [theme]);

  return {
    theme,
    colors: themeColors,
    isDark: theme === 'dark',
  };
}
