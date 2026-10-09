export const SECRET_SETTING_KEYS = ['gemini_api_key', 'chat_openrouter_api_key'] as const;
export type SecretSettingKey = typeof SECRET_SETTING_KEYS[number];

export function isSecretSettingKey(key: string): key is SecretSettingKey {
  return (SECRET_SETTING_KEYS as readonly string[]).includes(key);
}
