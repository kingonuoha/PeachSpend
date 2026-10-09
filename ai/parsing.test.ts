import { describe, expect, it } from 'vitest';

import { parseReceiptResponse } from './parsing';

const response = (itemExtra: string) =>
  `{"legibility":"good","items":[{"merchant":"Cafe","item_name":"Latte","amount":5,"category":"Dining","currency":"USD"${itemExtra}}]}`;

describe('parseReceiptResponse confidence', () => {
  it('keeps a provider-supplied confidence fraction', () => {
    const { items } = parseReceiptResponse(response(',"confidence":0.42'));
    expect(items[0].confidence).toBe(0.42);
  });

  it('leaves confidence undefined when the provider omits it', () => {
    const { items } = parseReceiptResponse(response(''));
    expect(items[0].confidence).toBeUndefined();
  });

  it('leaves confidence undefined for out-of-range or non-numeric values', () => {
    for (const value of ['0', '1.5', '90', '"high"', 'null']) {
      const { items } = parseReceiptResponse(response(`,"confidence":${value}`));
      expect(items[0].confidence).toBeUndefined();
    }
  });
});
