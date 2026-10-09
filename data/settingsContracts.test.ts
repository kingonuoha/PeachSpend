import { describe, expect, it } from 'vitest';
import type { AutoCaptureSettings, OnboardingSettings, OnboardingSettingsStore } from './contracts';

class MemorySettings implements OnboardingSettingsStore {
  private values = new Map<string, string>();
  async isOnboardingComplete(): Promise<boolean> { return this.values.get('onboarding_complete') === 'true'; }
  async completeOnboarding(settings: OnboardingSettings): Promise<void> {
    this.values.set('onboarding_complete', 'true');
    this.values.set('currency', settings.currency);
    if (settings.profileName) this.values.set('profile_name', settings.profileName);
    if (settings.monthlyBudget) this.values.set('monthly_budget', settings.monthlyBudget);
  }
  async getAutoCaptureSettings(): Promise<AutoCaptureSettings> {
    return { enabled: this.values.get('auto_capture_enabled') === 'true', permission: (this.values.get('auto_capture_permission') as AutoCaptureSettings['permission']) ?? 'unsupported' };
  }
  async updateAutoCaptureSettings(settings: Partial<AutoCaptureSettings>): Promise<AutoCaptureSettings> {
    if (settings.enabled !== undefined) this.values.set('auto_capture_enabled', String(settings.enabled));
    if (settings.permission) this.values.set('auto_capture_permission', settings.permission);
    return this.getAutoCaptureSettings();
  }
}

describe('onboarding and auto-capture settings contracts', () => {
  it('persists complete onboarding values without requiring budget', async () => {
    const store = new MemorySettings();
    await store.completeOnboarding({ profileName: 'Peach', currency: 'CAD' });
    expect(await store.isOnboardingComplete()).toBe(true);
  });

  it('keeps auto-capture setting and permission state separate', async () => {
    const store = new MemorySettings();
    expect(await store.updateAutoCaptureSettings({ permission: 'granted' })).toEqual({ enabled: false, permission: 'granted' });
    expect(await store.updateAutoCaptureSettings({ enabled: true })).toEqual({ enabled: true, permission: 'granted' });
  });
});
