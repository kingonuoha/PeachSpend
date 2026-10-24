import { describe, expect, it, vi } from 'vitest';
import { mergeOnboardingSettings } from './SettingsProvider';

// SettingsProvider renders no UI, but importing it pulls in the SQLite service and
// expo-secure-store. This suite only exercises the pure onboarding mirror, so those
// two native-backed modules are stubbed. Vitest hoists these above the import, and
// the mirror under test imports nothing from them.
vi.mock('../../services/DatabaseService', () => ({
  databaseService: { completeOnboarding: vi.fn(), getAllSettings: vi.fn(), updateSetting: vi.fn() },
}));
vi.mock('../../data/secrets', () => ({
  isSecretSettingKey: () => false,
  maskSecret: () => null,
}));

const BASE = { theme: 'dark', currency: 'NGN', monthly_budget: '0', budget_currency: 'NGN' };

describe('SettingsProvider onboarding mirror (BUG-09-04b)', () => {
  it('mirrors a valid budget in canonical form, the value the store writes', () => {
    const next = mergeOnboardingSettings(BASE, { currency: 'NGN', monthlyBudget: '4500' });
    expect(next.monthly_budget).toBe('4500');
    expect(next.onboarding_complete).toBe('true');
  });

  it('canonicalises surrounding whitespace the same way the store does', () => {
    expect(mergeOnboardingSettings(BASE, { currency: 'NGN', monthlyBudget: ' 4500 ' }).monthly_budget).toBe('4500');
  });

  it('leaves the previous budget alone when the value is refused', () => {
    // The device value. A partial read made this a cap of 66, so the mirror must
    // never carry it; the previous snapshot value is kept instead.
    const next = mergeOnboardingSettings(BASE, { currency: 'NGN', monthlyBudget: '66,000' });
    expect(next.monthly_budget).toBe('0');
  });

  it('refuses a negative entry rather than mirroring it', () => {
    expect(mergeOnboardingSettings(BASE, { currency: 'NGN', monthlyBudget: '-4500' }).monthly_budget).toBe('0');
  });

  it('leaves the previous budget alone for a blank or absent entry', () => {
    const prev = { ...BASE, monthly_budget: '4500' };
    expect(mergeOnboardingSettings(prev, { currency: 'NGN', monthlyBudget: '   ' }).monthly_budget).toBe('4500');
    expect(mergeOnboardingSettings(prev, { currency: 'NGN' }).monthly_budget).toBe('4500');
  });

  it('still mirrors the currency, the profile name and the completion flag', () => {
    const next = mergeOnboardingSettings(BASE, { currency: 'EUR', profileName: '  Ada  ', monthlyBudget: '1000' });
    expect(next.currency).toBe('EUR');
    expect(next.budget_currency).toBe('EUR');
    expect(next.profile_name).toBe('Ada');
    expect(next.onboarding_complete).toBe('true');
    expect(next.monthly_budget).toBe('1000');
  });

  it('does not mutate the previous snapshot', () => {
    const prev = { ...BASE, monthly_budget: '0' };
    mergeOnboardingSettings(prev, { currency: 'NGN', monthlyBudget: '4500' });
    expect(prev.monthly_budget).toBe('0');
  });
});
