import { describe, expect, it } from 'vitest';
import { formatCurrency, resolveCurrency, resolveDisplayCurrency, resolveUserCurrency } from './currency';

describe('currency resolution', () => {
  it('defaults to NGN only when no user or record currency exists', () => {
    expect(resolveUserCurrency()).toBe('NGN');
    expect(resolveCurrency()).toBe('NGN');
  });

  it('preserves selected non-NGN user currency', () => {
    expect(resolveUserCurrency('EUR')).toBe('EUR');
    expect(resolveDisplayCurrency('EUR', 'NGN')).toBe('EUR');
  });

  it('preserves stored record currency over fallback currency', () => {
    expect(resolveCurrency('CAD', 'EUR')).toBe('CAD');
    expect(formatCurrency(12.5, 'CAD', 'EUR')).toBe('$12.50');
  });

  it('uses NGN when formatter has no currency input', () => {
    expect(formatCurrency(12.5)).toBe('₦12.50');
    expect(formatCurrency(12.5, null, null)).toBe('₦12.50');
  });
});

describe('formatCurrency', () => {
  it.each([
    ['EUR', '€12.50'],
    ['NGN', '₦12.50'],
    ['ZZZ', 'ZZZ 12.50'],
  ])('formats %s without substituting another currency', (currency, expected) => {
    expect(formatCurrency(12.5, currency)).toBe(expected);
  });

  it('does not invent amount for invalid values', () => {
    expect(formatCurrency(Number.NaN, 'ZZZ')).toBe('ZZZ --');
  });
});
