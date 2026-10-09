import { useState, useEffect, useCallback } from 'react';
import { databaseService } from '../services/DatabaseService';
import { logger } from '../utils/logger';
import { resolveUserCurrency } from '../utils/currency';
import { isSecretSettingKey } from '../data/secrets';
import { omitSecretSettings } from './settingsBoundary';

export function useSettings() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);

  const getSetting = useCallback(async (key: string) => {
    if (isSecretSettingKey(key)) return null;
    try {
      return await databaseService.getSetting(key);
    } catch {
      logger.error(`useSettings get error for ${key}`, 'settings_read_failed');
      return null;
    }
  }, []);

  const updateSetting = async (key: string, value: string) => {
    try {
      await databaseService.updateSetting(key, value);
      if (!isSecretSettingKey(key)) setSettings(prev => ({ ...prev, [key]: value }));
    } catch (error) {
      logger.error(`useSettings update error for ${key}`, 'settings_update_failed');
      throw error;
    }
  };

  // Load common settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const onboarding = await databaseService.getSetting('onboarding_complete');
        const currency = await databaseService.getSetting('currency');
        const theme = await databaseService.getSetting('theme');
        
        setSettings(omitSecretSettings({
          onboarding_complete: onboarding || 'false',
          currency: resolveUserCurrency(currency),
          theme: theme || 'dark',
        }));
      } catch {
        logger.error('useSettings load error', 'settings_load_failed');
      } finally {
        setIsLoading(false);
      }
    };

    loadSettings();
  }, []);

  return {
    settings,
    isLoading,
    getSetting,
    updateSetting,
    currency: resolveUserCurrency(settings.currency),
    theme: settings.theme || 'dark',
  };
}
