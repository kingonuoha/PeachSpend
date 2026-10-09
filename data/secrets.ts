import * as SecureStore from 'expo-secure-store';
import { registerSensitiveValue } from '../utils/logger';
import { SECRET_SETTING_KEYS, type SecretSettingKey } from './secretKeys';

export { SECRET_SETTING_KEYS, isSecretSettingKey } from './secretKeys';
export type { SecretSettingKey } from './secretKeys';

// Constant, length-independent mask. It never echoes any character of the real
// key, so it cannot be used to reconstruct a prefix or tail, and it does not leak
// the key length. A non-null result still tells the settings UI that a key is set.
const MASKED_SECRET = '••••••••••••';

export function maskSecret(value: string | null | undefined): string | null {
  if (!value) return null;
  return MASKED_SECRET;
}

export async function getSecret(key: SecretSettingKey): Promise<string | null> {
  const value = await SecureStore.getItemAsync(`peachspend.${key}`);
  registerSensitiveValue(value);
  return value;
}

export async function setSecret(key: SecretSettingKey, value: string | null): Promise<void> {
  registerSensitiveValue(value);
  if (value) await SecureStore.setItemAsync(`peachspend.${key}`, value);
  else await SecureStore.deleteItemAsync(`peachspend.${key}`);
}

export async function deleteSecret(key: SecretSettingKey): Promise<void> {
  await SecureStore.deleteItemAsync(`peachspend.${key}`);
}

export async function migrateLegacySecrets(read: (key: string) => Promise<string | null>, remove: (key: string) => Promise<void>): Promise<void> {
  for (const key of SECRET_SETTING_KEYS) {
    const existing = await getSecret(key);
    const legacy = await read(key);
    if (!existing && legacy) await setSecret(key, legacy);
    if (legacy) await remove(key);
  }
}
