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
