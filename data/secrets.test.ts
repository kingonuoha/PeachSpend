import { describe, expect, it, vi } from 'vitest';
import { maskSecret } from './secrets';

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

describe('maskSecret', () => {
  it('never retains a character of the provider key', () => {
    const key = 'AIzaSyA-first-three-and-last-two';
    const masked = maskSecret(key);

    expect(masked).not.toBeNull();
    for (const character of key) {
      expect(masked).not.toContain(character);
    }
  });

  it('returns the same constant mask regardless of key length', () => {
    expect(maskSecret('short')).toBe(maskSecret('a-much-longer-provider-key-value'));
  });

  it('returns null for empty values', () => {
    expect(maskSecret('')).toBeNull();
    expect(maskSecret(null)).toBeNull();
    expect(maskSecret(undefined)).toBeNull();
  });
});
