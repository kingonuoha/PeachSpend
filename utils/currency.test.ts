import { describe, expect, it } from 'vitest';
import {
  formatAmountInput,
  formatCompactCurrency,
  formatCurrency,
  formatMoneyNumber,
  resolveCurrency,
  resolveDisplayCurrency,
  resolveUserCurrency,
} from './currency';

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

describe('formatMoneyNumber', () => {
  it('groups thousands and applies the whole-amount rule', () => {
    expect(formatMoneyNumber(2900)).toBe('2,900');
    expect(formatMoneyNumber(2900.5)).toBe('2,900.50');
    expect(formatMoneyNumber(1842.5)).toBe('1,842.50');
  });

  it('keeps the minus sign on a negative number', () => {
    expect(formatMoneyNumber(-1000)).toBe('-1,000');
  });

  it('does not invent a value for an invalid number', () => {
    expect(formatMoneyNumber(Number.NaN)).toBe('--');
  });
});

describe('formatCurrency grouping, decimals and the currency parameter', () => {
  it('groups thousands so 2900 reads as 2,900', () => {
    expect(formatCurrency(2900, 'NGN')).toBe('₦2,900');
  });

  it('drops .00 on a whole amount and keeps two decimals otherwise', () => {
    expect(formatCurrency(3450, 'USD')).toBe('$3,450');
    expect(formatCurrency(1842.5, 'USD')).toBe('$1,842.50');
  });

  it('holds the grouping boundary at 999, 1,000 and 10,000', () => {
    expect(formatCurrency(999, 'USD')).toBe('$999');
    expect(formatCurrency(1000, 'USD')).toBe('$1,000');
    expect(formatCurrency(10000, 'USD')).toBe('$10,000');
  });

  it('renders zero and negative amounts, keeping the minus outside the symbol', () => {
    expect(formatCurrency(0, 'USD')).toBe('$0');
    expect(formatCurrency(-2900, 'NGN')).toBe('-₦2,900');
    expect(formatCurrency(-64.2, 'USD')).toBe('-$64.20');
  });

  it('takes the symbol and its position from the currency, not from a literal', () => {
    expect(formatCurrency(1250.5, 'EUR')).toBe('€1,250.50');
    expect(formatCurrency(1250, 'GBP')).toBe('£1,250');
    expect(formatCurrency(1250, 'SEK')).toBe('1,250 kr');
  });
});

describe('formatCompactCurrency', () => {
  it('keeps the full grouped value below ten thousand', () => {
    expect(formatCompactCurrency(2900, 'NGN')).toBe('₦2,900');
    expect(formatCompactCurrency(2900.5, 'NGN')).toBe('₦2,900.50');
  });

  it('abbreviates at and above ten thousand', () => {
    expect(formatCompactCurrency(12000, 'USD')).toBe('$12k');
    expect(formatCompactCurrency(12500, 'USD')).toBe('$12.5k');
    expect(formatCompactCurrency(1200000, 'USD')).toBe('$1.2M');
  });

  it('respects a suffix placement in the compact form too', () => {
    expect(formatCompactCurrency(12500, 'SEK')).toBe('12.5k kr');
  });
});

describe('formatAmountInput', () => {
  it('formats raw numeric strings with comma grouping as user types', () => {
    expect(formatAmountInput('56335')).toBe('56,335');
    expect(formatAmountInput('56335.')).toBe('56,335.');
    expect(formatAmountInput('56335.5')).toBe('56,335.5');
    expect(formatAmountInput('56335.50')).toBe('56,335.50');
    expect(formatAmountInput('0')).toBe('0');
    expect(formatAmountInput('0.00')).toBe('0.00');
    expect(formatAmountInput('')).toBe('');
  });
});
