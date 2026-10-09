import { isSecretSettingKey } from '../data/secretKeys';

export function omitSecretSettings(settings: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(settings).filter(([key]) => !isSecretSettingKey(key)));
}
