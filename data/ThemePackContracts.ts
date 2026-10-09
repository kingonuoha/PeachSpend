import { DarkTheme, LightTheme } from '../constants/tokens';
import type { SettingsPort } from './SettingsContracts';

export type ThemeMode = 'light' | 'dark';

export interface ThemePackVariantMap {
  readonly [token: string]: string;
}

export interface ThemePackDefinition {
  id: string;
  label: string;
  isDefault: boolean;
  variants: { light: ThemePackVariantMap; dark: ThemePackVariantMap };
}

export const DEFAULT_THEME_PACK_ID = 'purple';

// FR-05.5 theme-pack registry. A pack appears here only once it defines both a
// light and a dark variant; the master index names three alternate packs but
// they are not implemented, so they are deliberately absent rather than exposed
// as dark-only or light-only options. Purple maps to the locked token sets.
export const THEME_PACKS: readonly ThemePackDefinition[] = [
  {
    id: 'purple',
    label: 'Purple',
    isDefault: true,
    variants: { light: LightTheme, dark: DarkTheme },
  },
];

export interface ThemePackOption {
  id: string;
  label: string;
  isDefault: boolean;
}

export interface ThemePackState {
  activePackId: string;
  mode: ThemeMode;
  packs: ThemePackOption[];
  palette: ThemePackVariantMap;
}

export function resolveThemePack(id: string | null | undefined): ThemePackDefinition {
  const found = THEME_PACKS.find(pack => pack.id === id);
  return found ?? THEME_PACKS.find(pack => pack.isDefault) ?? THEME_PACKS[0];
}

export function resolveThemeMode(value: string | null | undefined): ThemeMode {
  return value === 'light' ? 'light' : 'dark';
}

export function isThemePackSelectable(id: string): boolean {
  const pack = THEME_PACKS.find(candidate => candidate.id === id);
  if (!pack) return false;
  return Object.keys(pack.variants.light).length > 0 && Object.keys(pack.variants.dark).length > 0;
}

// Theme pack and light/dark are independent axes (FR-05.5, FR-06.7). This read
// model takes each stored setting separately and never derives one from the
// other, so switching either setting preserves the other.
export function buildThemePackState(
  packSetting: string | null | undefined,
  modeSetting: string | null | undefined,
): ThemePackState {
  const pack = resolveThemePack(packSetting);
  const mode = resolveThemeMode(modeSetting);
  return {
    activePackId: pack.id,
    mode,
    packs: THEME_PACKS.map(candidate => ({ id: candidate.id, label: candidate.label, isDefault: candidate.isDefault })),
    palette: pack.variants[mode],
  };
}

export type ThemePackSetResult =
  | { status: 'saved'; state: ThemePackState }
  | { status: 'unsupported'; id: string };

export async function setThemePack(port: SettingsPort, id: string): Promise<ThemePackSetResult> {
  if (!isThemePackSelectable(id)) return { status: 'unsupported', id };
  await port.updateSetting('theme_pack', id);
  const [packSetting, modeSetting] = await Promise.all([port.getSetting('theme_pack'), port.getSetting('theme')]);
  return { status: 'saved', state: buildThemePackState(packSetting, modeSetting) };
}

export async function setThemeMode(port: SettingsPort, mode: ThemeMode): Promise<ThemePackState> {
  await port.updateSetting('theme', mode);
  const [packSetting, modeSetting] = await Promise.all([port.getSetting('theme_pack'), port.getSetting('theme')]);
  return buildThemePackState(packSetting, modeSetting);
}
