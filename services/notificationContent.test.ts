import { describe, expect, it, vi } from 'vitest';
import {
  buildExpenseNotificationBody,
  isAmountVisible,
  resolveAmountVisibility,
} from './notificationContent';

describe('notification amount visibility', () => {
  it('treats the prices_visible false value as hidden and everything else as visible', () => {
    expect(isAmountVisible('false')).toBe(false);
    expect(isAmountVisible('true')).toBe(true);
    expect(isAmountVisible(null)).toBe(true);
  });

  it('resolves visibility through the injected settings reader', async () => {
    await expect(resolveAmountVisibility(vi.fn(async () => 'false'))).resolves.toBe(false);
    await expect(resolveAmountVisibility(vi.fn(async () => 'true'))).resolves.toBe(true);
    await expect(resolveAmountVisibility(vi.fn(async () => null))).resolves.toBe(true);
  });

  it('fails closed and hides the amount when the settings reader rejects', async () => {
    const reader = vi.fn(async () => {
      throw new Error('settings unavailable');
    });

    await expect(resolveAmountVisibility(reader)).resolves.toBe(false);
  });
});

describe('expense notification body', () => {
  const single = [{ merchant: 'Coffee Shop', amount: 'NGN 1,200.00' }];
  const batch = [
    { merchant: 'Cafe One', amount: 'NGN 10.00' },
    { merchant: 'Cafe Two', amount: 'NGN 20.00' },
  ];

  it('includes the amount when visible', () => {
    expect(buildExpenseNotificationBody(single, true)).toBe('Coffee Shop - NGN 1,200.00');
  });

  it('omits the amount from a single entry when hidden', () => {
    const body = buildExpenseNotificationBody(single, false);
    expect(body).toBe('Coffee Shop');
    expect(body).not.toContain('1,200.00');
  });

  it('omits every amount from a batch when hidden while keeping each merchant', () => {
    const body = buildExpenseNotificationBody(batch, false);
    expect(body).toBe('Cafe One\nCafe Two');
    expect(body).not.toContain('10.00');
    expect(body).not.toContain('20.00');
  });
});
