import { describe, expect, it } from 'vitest';
import { formatConversionRate, parseCurrencyRateMap } from './contracts';

describe('currency conversion rate boundary', () => {
  it('parses stored rate JSON without inventing entries', () => {
    expect(parseCurrencyRateMap('{"USD":1,"eur":0.924}')).toEqual({ USD: 1, EUR: 0.924 });
  });

  it('drops invalid, non-positive and non-numeric entries instead of defaulting them', () => {
    expect(parseCurrencyRateMap('{"USD":1,"BAD":"x","ZERO":0,"NEG":-3}')).toEqual({ USD: 1 });
  });

  it('returns an empty map for absent or malformed settings', () => {
    expect(parseCurrencyRateMap(undefined)).toEqual({});
    expect(parseCurrencyRateMap('')).toEqual({});
    expect(parseCurrencyRateMap('not json')).toEqual({});
    expect(parseCurrencyRateMap('[1,2]')).toEqual({});
  });

  it('formats a stored rate only when it is a real positive number', () => {
    expect(formatConversionRate(0.924)).toBe('0.924');
    expect(formatConversionRate(0)).toBe('');
    expect(formatConversionRate(-1)).toBe('');
    expect(formatConversionRate(Number.NaN)).toBe('');
    expect(formatConversionRate(undefined)).toBe('');
  });
});
