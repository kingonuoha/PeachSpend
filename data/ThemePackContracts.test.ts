import { describe, expect, it } from 'vitest';
import {
  DEFAULT_THEME_PACK_ID, THEME_PACKS, buildThemePackState, isThemePackSelectable,
  resolveThemeMode, resolveThemePack, setThemeMode, setThemePack,
} from './ThemePackContracts';
import type { SettingsPort } from './SettingsContracts';

class MemorySettings implements SettingsPort {
  values = new Map<string, string>();
  async getSetting(key: string): Promise<string | null> { return this.values.get(key) ?? null; }
  async updateSetting(key: string, value: string): Promise<void> { this.values.set(key, value); }
}

describe('theme pack registry', () => {
  it('exposes only packs that define both a light and a dark variant', () => {
    expect(THEME_PACKS.length).toBeGreaterThan(0);
    for (const pack of THEME_PACKS) {
      expect(Object.keys(pack.variants.light).length).toBeGreaterThan(0);
      expect(Object.keys(pack.variants.dark).length).toBeGreaterThan(0);
      expect(isThemePackSelectable(pack.id)).toBe(true);
    }
  });

  it('keeps purple as the default and rejects an unknown pack id', () => {
    expect(resolveThemePack(null).id).toBe(DEFAULT_THEME_PACK_ID);
    expect(isThemePackSelectable('trust-ledger')).toBe(false);
    expect(resolveThemeMode('light')).toBe('light');
    expect(resolveThemeMode(undefined)).toBe('dark');
  });

  it('keeps pack and light/dark independent in the read model', () => {
    const light = buildThemePackState(DEFAULT_THEME_PACK_ID, 'light');
    const dark = buildThemePackState(DEFAULT_THEME_PACK_ID, 'dark');
    expect(light.activePackId).toBe(dark.activePackId);
    expect(light.palette).not.toEqual(dark.palette);
  });
});

describe('theme pack write boundaries', () => {
  it('saves a selectable pack without changing the light/dark mode', async () => {
    const port = new MemorySettings();
    await port.updateSetting('theme', 'light');

    const result = await setThemePack(port, DEFAULT_THEME_PACK_ID);

    expect(result).toEqual({
      status: 'saved',
      state: expect.objectContaining({ activePackId: DEFAULT_THEME_PACK_ID, mode: 'light' }),
    });
  });

  it('refuses an unimplemented pack instead of exposing a partial variant', async () => {
    const port = new MemorySettings();
    await expect(setThemePack(port, 'emerald-vault')).resolves.toEqual({ status: 'unsupported', id: 'emerald-vault' });
    expect(port.values.has('theme_pack')).toBe(false);
  });

  it('changes light/dark without changing the active pack', async () => {
    const port = new MemorySettings();
    await port.updateSetting('theme_pack', DEFAULT_THEME_PACK_ID);

    const state = await setThemeMode(port, 'light');

    expect(state.activePackId).toBe(DEFAULT_THEME_PACK_ID);
    expect(state.mode).toBe('light');
  });
});
