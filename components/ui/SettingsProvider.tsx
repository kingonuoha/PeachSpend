import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from 'react';
import { databaseService } from '../../services/DatabaseService';
import { logger } from '../../utils/logger';

interface SettingsContextType {
  settings: Record<string, string>;
  updateSetting: (key: string, value: string) => Promise<void>;
  isLoading: boolean;
  currency: string;
  theme: 'dark' | 'light';
  getCurrencySymbol: (cc?: string) => string;
  convertAmount: (amount: number, fromCurrency: string) => { amount: number; symbol: string };
  conversionRates: Record<string, number>;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

const DEFAULT_RATES: Record<string, number> = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.79,
  JPY: 151,
  NGN: 1550,
  CAD: 1.36,
  AUD: 1.52,
};

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);

  const loadSettings = useCallback(async () => {
    try {
      const allSettings = await databaseService.getAllSettings();
      const merged: Record<string, string> = {
        theme: 'dark',
        currency: 'USD',
        onboarding_complete: 'false',
        prices_visible: 'true',
        monthly_budget: '0',
        budget_currency: 'USD',
        last_opened_date: '',
        last_streak: '0',
        ...allSettings
      };

      // Seed default conversion rates if missing or empty
      const existingRates = merged.conversion_rates;
      if (!existingRates || existingRates === '{}') {
        merged.conversion_rates = JSON.stringify(DEFAULT_RATES);
        await databaseService.updateSetting('conversion_rates', merged.conversion_rates);
      }

      setSettings(merged);
    } catch (error) {
      logger.error('Failed to load settings in Provider', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const updateSetting = async (key: string, value: string) => {
    try {
      await databaseService.updateSetting(key, value);
      setSettings(prev => ({ ...prev, [key]: value }));
    } catch (error) {
      logger.error(`Failed to update setting ${key}`, error);
      throw error;
    }
  };

  const currency = settings.currency || 'USD';
  const theme = (settings.theme === 'light' ? 'light' : 'dark') as 'dark' | 'light';

  const conversionRates = useMemo(() => {
    try {
      return { ...DEFAULT_RATES, ...JSON.parse(settings.conversion_rates || '{}') };
    } catch {
      return { ...DEFAULT_RATES };
    }
  }, [settings.conversion_rates]);

  const getCurrencySymbol = (cc?: string) => {
    const code = cc || currency;
    switch (code) {
      case 'EUR': return '€';
      case 'GBP': return '£';
      case 'JPY': return '¥';
      case 'NGN': return '₦';
      case 'CAD':
      case 'AUD': 
      case 'USD': return '$';
      default: return '$';
    }
  };

  const convertAmount = (amount: number, fromCurrency: string) => {
    if (fromCurrency === currency) {
      return { amount, symbol: getCurrencySymbol() };
    }
    const rateFrom = conversionRates[fromCurrency] || 1;
    const rateTo = conversionRates[currency] || 1;
    const converted = amount * rateFrom / rateTo;
    return { amount: converted, symbol: getCurrencySymbol() };
  };

  return (
    <SettingsContext.Provider 
      value={{ 
        settings, 
        updateSetting, 
        isLoading, 
        currency, 
        theme,
        getCurrencySymbol,
        convertAmount,
        conversionRates
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (context === undefined) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
}
