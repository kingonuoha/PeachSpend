import { describe, expect, it, vi } from 'vitest';
import {
  CategoryLimitError, CategoryLimitService, CATEGORY_LIMIT_KEY_PREFIX,
  categoryLimitKey, extractCategoryIdFromLimitKey, formatCategoryLimit, parseCategoryLimit, validateCategoryLimitAmount,
  type CategoryLimitPort,
} from './CategoryLimits';

class MemoryPort implements CategoryLimitPort {
  values = new Map<string, string>();
  getAllSettings = vi.fn(async () => Object.fromEntries(this.values));
  getSetting = vi.fn(async (key: string) => this.values.get(key) ?? null);
  updateSetting = vi.fn(async (key: string, value: string) => { this.values.set(key, value); });
  deleteSetting = vi.fn(async (key: string) => { this.values.delete(key); });
}

const service = () => {
  const port = new MemoryPort();
  return { port, limits: new CategoryLimitService(port) };
};

describe('category limit keys and stored values', () => {
  it('uses the documented settings key format', () => {
    expect(categoryLimitKey('dining')).toBe(`${CATEGORY_LIMIT_KEY_PREFIX}dining`);
  });

  it('refuses an empty category id instead of writing a shared key', () => {
    expect(() => categoryLimitKey('   ')).toThrow(CategoryLimitError);
  });

  it('reads only a positive amount back as a limit', () => {
    expect(parseCategoryLimit('120.5')).toBe(120.5);
    expect(parseCategoryLimit('0')).toBeNull();
    expect(parseCategoryLimit('-5')).toBeNull();
    expect(parseCategoryLimit('')).toBeNull();
    expect(parseCategoryLimit('not a number')).toBeNull();
    expect(parseCategoryLimit(null)).toBeNull();
  });

  it('treats zero as cleared and refuses negative or non finite amounts', () => {
    expect(validateCategoryLimitAmount(0)).toEqual({ status: 'cleared', amount: 0 });
    expect(validateCategoryLimitAmount(-1)).toEqual({ status: 'invalid', reason: 'negative' });
    expect(validateCategoryLimitAmount(Number.NaN)).toEqual({ status: 'invalid', reason: 'not_finite' });
    expect(validateCategoryLimitAmount(Number.POSITIVE_INFINITY)).toEqual({ status: 'invalid', reason: 'not_finite' });
    expect(validateCategoryLimitAmount(42)).toEqual({ status: 'valid', amount: 42 });
  });

  it('stores a plain numeric string with no symbol or separator', () => {
    expect(formatCategoryLimit(1250)).toBe('1250');
    expect(formatCategoryLimit(12.345)).toBe('12.35');
  });

  it('extracts a category id only from a limit key', () => {
    expect(extractCategoryIdFromLimitKey('category_limit_groceries')).toBe('groceries');
    expect(extractCategoryIdFromLimitKey('monthly_budget')).toBeNull();
    expect(extractCategoryIdFromLimitKey('category_limit_')).toBeNull();
  });
});

describe('category limit service', () => {
  it('sets and reads back a limit for one category', async () => {
    const { limits } = service();

    await limits.setCategoryLimit('dining', 250);

    await expect(limits.getCategoryLimit('dining')).resolves.toBe(250);
  });

  it('returns null for a category with no limit', async () => {
    const { limits } = service();

    await expect(limits.getCategoryLimit('travel')).resolves.toBeNull();
  });

  it('clears a limit with a real delete rather than a zero value', async () => {
    const { port, limits } = service();
    await limits.setCategoryLimit('dining', 250);

    await limits.clearCategoryLimit('dining');

    expect(port.values.has('category_limit_dining')).toBe(false);
    expect(port.deleteSetting).toHaveBeenCalledWith('category_limit_dining');
    await expect(limits.getCategoryLimit('dining')).resolves.toBeNull();
  });

  it('treats setting zero as clearing', async () => {
    const { port, limits } = service();
    await limits.setCategoryLimit('dining', 250);

    await limits.setCategoryLimit('dining', 0);

    expect(port.values.has('category_limit_dining')).toBe(false);
  });

  it('refuses a negative or non finite amount and writes nothing', async () => {
    const { port, limits } = service();

    await expect(limits.setCategoryLimit('dining', -10)).rejects.toBeInstanceOf(CategoryLimitError);
    await expect(limits.setCategoryLimit('dining', Number.NaN)).rejects.toBeInstanceOf(CategoryLimitError);

    expect(port.updateSetting).not.toHaveBeenCalled();
    expect(port.values.size).toBe(0);
  });

  it('reads every limit in one settings pass and keeps unrelated settings out', async () => {
    const { port, limits } = service();
    await limits.setCategoryLimit('dining', 100);
    await limits.setCategoryLimit('transport', 40.5);
    await port.updateSetting('monthly_budget', '900');
    await port.updateSetting('category_limit_broken', 'nope');

    await expect(limits.getAllCategoryLimits()).resolves.toEqual({ dining: 100, transport: 40.5 });
    expect(port.getAllSettings).toHaveBeenCalledTimes(1);
    expect(port.getSetting).toHaveBeenCalledTimes(0);
  });
});
