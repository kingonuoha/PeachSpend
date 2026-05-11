import { useState, useEffect, useCallback } from 'react';
import { databaseService } from '../services/DatabaseService';
import { logger } from '../utils/logger';

export function useSettings() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);

  const getSetting = useCallback(async (key: string) => {
    try {
      return await databaseService.getSetting(key);
    } catch (error) {
      logger.error(`useSettings get error for ${key}:`, error);
      return null;
    }
  }, []);

  const updateSetting = async (key: string, value: string) => {
    try {
      await databaseService.updateSetting(key, value);
      setSettings(prev => ({ ...prev, [key]: value }));
    } catch (error) {
      logger.error(`useSettings update error for ${key}:`, error);
      throw error;
    }
  };

  // Load common settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const apiKey = await databaseService.getSetting('gemini_api_key');
        const onboarding = await databaseService.getSetting('onboarding_complete');
        const currency = await databaseService.getSetting('currency');
        const theme = await databaseService.getSetting('theme');
        
        setSettings({
          gemini_api_key: apiKey || '',
          onboarding_complete: onboarding || 'false',
          currency: currency || 'USD',
          theme: theme || 'dark',
        });
      } catch (error) {
        logger.error('useSettings load error:', error);
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
    currency: settings.currency || 'USD',
    theme: settings.theme || 'dark',
  };
}
