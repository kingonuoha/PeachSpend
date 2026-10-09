import { describe, expect, it } from 'vitest';
import { normalizeCurrencyTotal } from './currencyNormalization';

describe('normalizeCurrencyTotal', () => {
  it('sums entries already in the target currency without needing rates', () => {
    const result = normalizeCurrencyTotal([{ amount: 10, currency: 'CAD' }, { amount: 5, currency: 'cad' }, { amount: 2 }], 'CAD', null);
    expect(result).toEqual({ total: 17, currency: 'CAD', missingRates: [], complete: true });
  });

  it('converts through the stored rate map', () => {
    const result = normalizeCurrencyTotal([{ amount: 100, currency: 'CAD' }, { amount: 10, currency: 'USD' }], 'CAD', { CAD: 1, USD: 1.4 });
    expect(result.total).toBeCloseTo(114);
    expect(result.complete).toBe(true);
  });

  it('accepts the raw settings string for the rate map', () => {
    const result = normalizeCurrencyTotal([{ amount: 10, currency: 'USD' }], 'CAD', JSON.stringify({ CAD: 1, USD: 1.4 }));
    expect(result.total).toBeCloseTo(14);
  });

  it('excludes and reports amounts with no usable rate instead of counting at par', () => {
    const result = normalizeCurrencyTotal([{ amount: 100, currency: 'CAD' }, { amount: 10, currency: 'EUR' }, { amount: 20, currency: 'EUR' }], 'CAD', { CAD: 1 });
    expect(result.total).toBe(100);
    expect(result.missingRates).toEqual(['EUR']);
    expect(result.complete).toBe(false);
  });

  it('treats an unset target as an empty, incomplete total rather than inventing a currency', () => {
    const result = normalizeCurrencyTotal([{ amount: 10, currency: 'USD' }], null, { USD: 1 });
    expect(result).toEqual({ total: 0, currency: '', missingRates: ['USD'], complete: false });
  });

  it('ignores non-finite amounts', () => {
    const result = normalizeCurrencyTotal([{ amount: Number.NaN, currency: 'CAD' }, { amount: 4, currency: 'CAD' }], 'CAD', null);
    expect(result.total).toBe(4);
  });
});
