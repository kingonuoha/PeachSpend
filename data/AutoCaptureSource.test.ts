import { describe, expect, it, vi } from 'vitest';
import {
  createOptionalAutoCaptureSourceAdapter,
  createParsedAutoCaptureSource,
  createNotificationParser,
  parseNotificationCandidate,
  sanitizeNativeNotification,
  filterSupportedSources,
} from './AutoCaptureSource';
import type { AutoCaptureSourceDescriptor, NativeAutoCaptureNotification, NativeAutoCaptureSourceAdapter } from './contracts';

const source: AutoCaptureSourceDescriptor = {
  id: 'chase', packageName: 'com.chase.sig.android', displayName: 'Chase Mobile', status: 'active',
};
const notification: NativeAutoCaptureNotification = {
  id: 'notification-1', packageName: source.packageName, text: 'You made a $42.80 charge at Whole Foods Market.', receivedAt: 10,
};

function fakeAdapter(): NativeAutoCaptureSourceAdapter & { emit(value: NativeAutoCaptureNotification): void } {
  let listener: ((value: NativeAutoCaptureNotification) => void) | undefined;
  return {
    platform: 'android', capability: 'available',
    getPermissionState: vi.fn(async () => ({ status: 'granted' as const, canRequest: false })),
    getSupportedSources: vi.fn(async () => [source]),
    subscribe: (next) => { listener = next; return () => { listener = undefined; }; },
    setLifecycle: vi.fn(),
    openSystemSettings: vi.fn(async () => undefined),
    emit: value => listener?.(value),
  };
}

describe('optional auto-capture source boundary', () => {
  it('returns honest non-crashing capability without native module', async () => {
    const expoGo = createOptionalAutoCaptureSourceAdapter('android');
    const ios = createOptionalAutoCaptureSourceAdapter('ios');
    expect(expoGo.capability).toBe('unavailable');
    expect(ios.capability).toBe('unsupported');
    await expect(expoGo.getPermissionState()).resolves.toEqual({ status: 'unsupported', canRequest: false });
    await expect(expoGo.openSystemSettings()).resolves.toBeUndefined();
  });

  it('filters unsupported packages before parser boundary and hands parsed events onward', () => {
    const adapter = fakeAdapter();
    const events: unknown[] = [];
    const sourceAdapter = createParsedAutoCaptureSource(adapter, createNotificationParser(parseNotificationCandidate), [source]);
    sourceAdapter.setLifecycle?.(true, 'granted');
    sourceAdapter.subscribe(event => events.push(event));
    adapter.emit({ ...notification, packageName: 'unknown.package' });
    adapter.emit(notification);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ candidate: { merchant: 'Whole Foods Market', amount: 42.8, source: 'auto_capture' } });
    expect(adapter.setLifecycle).toHaveBeenCalledWith(true, 'granted');
  });

  it('disables native source before stopping publication', () => {
    const adapter = fakeAdapter();
    const sourceAdapter = createParsedAutoCaptureSource(adapter, createNotificationParser(parseNotificationCandidate), [source]);
    sourceAdapter.setLifecycle?.(true, 'granted');
    sourceAdapter.setLifecycle?.(false, 'granted');
    adapter.emit(notification);
    expect(adapter.setLifecycle).toHaveBeenLastCalledWith(false, 'granted');
  });

  it('parses a 5 digit Naira debit with comma grouping and merchant after at', () => {
    const candidate = parseNotificationCandidate(
      { id: 'naira-debit', packageName: source.packageName, title: 'Debit alert', text: 'N12,500.00 spent at Shoprite on your card.', receivedAt: 20 },
      source,
    );
    expect(candidate).toMatchObject({ merchant: 'Shoprite', amount: 12500, currency: 'NGN' });
  });

  it('parses credit phrasing with merchant after from and a grouped USD amount', () => {
    const candidate = parseNotificationCandidate(
      { id: 'credit', packageName: source.packageName, text: 'Credit alert: your account was credited with $1,234.56 from Jane Doe.', receivedAt: 21 },
      source,
    );
    expect(candidate).toMatchObject({ merchant: 'Jane Doe', amount: 1234.56, currency: 'USD' });
  });

  it('parses merchant after to and survives a missing title without crashing', () => {
    const candidate = parseNotificationCandidate(
      { id: 'transfer', packageName: source.packageName, text: 'You sent NGN 25,000 to John Okoro.', receivedAt: 22 },
      source,
    );
    expect(candidate).toMatchObject({ merchant: 'John Okoro', amount: 25000, currency: 'NGN' });
  });

  it('parses a whole 5 digit Naira amount with no decimals', () => {
    const candidate = parseNotificationCandidate(
      { id: 'naira-whole', packageName: source.packageName, text: 'Debit: N5,000 spent at Ebeano.', receivedAt: 23 },
      source,
    );
    expect(candidate).toMatchObject({ merchant: 'Ebeano', amount: 5000, currency: 'NGN' });
  });

  it('rejects a card ending pattern through the parser without leaking raw text', () => {
    const outcome = createNotificationParser(parseNotificationCandidate).parse(
      { ...notification, text: 'Card ending 1234 charged $42 at Store.' }, source,
    );
    expect(outcome).toEqual({ status: 'failed', code: 'invalid_notification' });
    expect(JSON.stringify(outcome)).not.toContain('1234');
  });

  it('passes through not_detected status instead of forcing active', () => {
    const idle = { ...source, status: 'not_detected' as const };
    expect(filterSupportedSources([idle], new Set([source.packageName]))).toEqual([idle]);
  });

  it('filters a package outside the allowlist even when installed', () => {
    const clone = { id: 'chase', packageName: 'com.evil.clone', displayName: 'Chase Mobile', status: 'active' as const };
    expect(filterSupportedSources([clone], new Set(['com.evil.clone']))).toEqual([]);
  });

  it('rejects non-transaction notification without exposing raw text', () => {
    const outcome = createNotificationParser(parseNotificationCandidate).parse(
      { ...notification, text: 'Your weekly account summary is ready' }, source,
    );
    expect(outcome).toEqual({ status: 'ignored', code: 'not_transaction' });
    expect(JSON.stringify(outcome)).not.toContain('weekly account');
  });

  it('rejects URLs, identifiers, and oversized notification text at boundary', () => {
    expect(sanitizeNativeNotification({ ...notification, text: 'Pay at https://merchant.test for $42' })).toBeNull();
    expect(sanitizeNativeNotification({ ...notification, text: 'Card ending 1234 charge $42' })).toBeNull();
    expect(sanitizeNativeNotification({ ...notification, text: 'x'.repeat(281) })).toBeNull();
    expect(JSON.stringify(sanitizeNativeNotification({ ...notification, text: 'x'.repeat(281) }))).not.toContain('x'.repeat(281));
  });

  it('normalizes only immutable supported source metadata and rejects stale sources', () => {
    const stale = { ...source, id: 'removed', displayName: 'Attacker label' };
    expect(filterSupportedSources([source, stale], new Set([source.packageName]))).toEqual([source]);
  });
});
