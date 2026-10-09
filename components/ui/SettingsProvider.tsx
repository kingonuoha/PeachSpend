import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from 'react';
import { databaseService } from '../../services/DatabaseService';
import { logger } from '../../utils/logger';
import { isSecretSettingKey, maskSecret } from '../../data/secrets';
import type { OnboardingSettings } from '../../data/contracts';
import { getCurrencyPrefix, resolveCurrency } from '../../utils/currency';

interface SettingsContextType {
  settings: Record<string, string>;
  updateSetting: (key: string, value: string) => Promise<void>;
  // Read-only re-read of every setting. Lets a typed contract (for example the
  // theme-pack write) surface in the app without opening a second settings writer.
  refreshSettings: () => Promise<void>;
  completeOnboarding: (settings: OnboardingSettings) => Promise<void>;
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
        currency: 'NGN',
        onboarding_complete: 'false',
        notifications_enabled: 'false',
        prices_visible: 'true',
        monthly_budget: '0',
        budget_currency: 'NGN',
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
    } catch {
      logger.error('settings_load_failed');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => { void loadSettings(); }, 0);
    return () => clearTimeout(timer);
  }, [loadSettings]);

  const updateSetting = async (key: string, value: string) => {
    try {
      await databaseService.updateSetting(key, value);
      setSettings(prev => ({ ...prev, [key]: isSecretSettingKey(key) ? (maskSecret(value) || '') : value }));
    } catch (error) {
      logger.error('settings_write_failed', key);
      throw error;
    }
  };

  // Single entry point for onboarding complete and skip. The store writes the
  // whole state in one transaction, then the provider mirrors it in one state
  // update so the re-entry guard never sees a partial result. No secret key is
  // touched here.
  const completeOnboarding = useCallback(async (onboarding: OnboardingSettings) => {
    await databaseService.completeOnboarding(onboarding);
    const profileName = onboarding.profileName?.trim();
    const monthlyBudget = onboarding.monthlyBudget?.trim();
    setSettings(prev => {
      const next: Record<string, string> = { ...prev, currency: onboarding.currency, budget_currency: onboarding.currency, onboarding_complete: 'true' };
      if (profileName) next.profile_name = profileName;
      if (monthlyBudget) next.monthly_budget = monthlyBudget;
      return next;
    });
  }, []);

  const currency = resolveCurrency(undefined, settings.currency || 'NGN');
  const theme = (settings.theme === 'light' ? 'light' : 'dark') as 'dark' | 'light';

  const conversionRates = useMemo(() => {
    try {
      return { ...DEFAULT_RATES, ...JSON.parse(settings.conversion_rates || '{}') };
    } catch {
      return { ...DEFAULT_RATES };
    }
  }, [settings.conversion_rates]);

  const getCurrencySymbol = (cc?: string) => {
    return getCurrencyPrefix(cc || currency);
  };

  const convertAmount = (amount: number, fromCurrency: string) => {
    const sourceCurrency = resolveCurrency(fromCurrency, currency);
    if (sourceCurrency === currency) {
      return { amount, symbol: getCurrencySymbol() };
    }
    const rateFrom = conversionRates[sourceCurrency] || 1;
    const rateTo = conversionRates[currency] || 1;
    const converted = amount * rateFrom / rateTo;
    return { amount: converted, symbol: getCurrencySymbol() };
  };

  return (
    <SettingsContext.Provider 
      value={{ 
        settings, 
        updateSetting, 
        refreshSettings: loadSettings,
        completeOnboarding,
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
