import React, { createContext, useContext, ReactNode } from 'react';
import { useTheme as useThemeHook } from '../../hooks/useTheme';
import { Colors } from '../../constants/tokens';

type ThemeContextType = ReturnType<typeof useThemeHook>;

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const themeData = useThemeHook();
  
  return (
    <ThemeContext.Provider value={themeData}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    // Fallback if provider is missing
    return {
      theme: 'dark' as const,
      colors: Colors,
      isDark: true
    };
  }
  return context;
}
