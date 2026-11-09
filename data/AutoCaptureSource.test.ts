import { describe, expect, it, vi } from 'vitest';
import {
  AUTO_CAPTURE_INCOME_CATEGORY,
  createOptionalAutoCaptureSourceAdapter,
  createParsedAutoCaptureSource,
  createNotificationParser,
  detectTransferDirection,
  parseAutoCaptureDetection,
  parseNotificationCandidate,
  resolveSourceDisplayName,
  sanitizeNativeNotification,
  filterSupportedSources,
  isRegistryPackage,
  passesShapedGate,
} from './AutoCaptureSource';
import type { AutoCaptureSourceDescriptor, NativeAutoCaptureNotification, NativeAutoCaptureSourceAdapter } from './contracts';

const source: AutoCaptureSourceDescriptor = {
  id: 'chase', packageName: 'com.chase.sig.android', displayName: 'Chase Mobile', status: 'active',
};
const opaySource: AutoCaptureSourceDescriptor = {
  id: 'opay', packageName: 'team.opay.pay', displayName: 'OPay', status: 'active',
};
const smsFallback: AutoCaptureSourceDescriptor = {
  id: 'com.example.smsapp', packageName: 'com.example.smsapp', displayName: 'com.example.smsapp', status: 'active',
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

  it('parses a named NG bank debit alert from the extended registry', () => {
    expect(isRegistryPackage('team.opay.pay')).toBe(true);
    const candidate = parseNotificationCandidate(
      { id: 'opay-debit', packageName: opaySource.packageName, title: 'Debit alert', text: 'N12,500.00 spent at Shoprite.', receivedAt: 30 },
      opaySource,
    );
    expect(candidate).toMatchObject({ merchant: 'Shoprite', amount: 12500, currency: 'NGN' });
  });

  it('parses an unlisted package whose text is transaction shaped', () => {
    expect(isRegistryPackage(smsFallback.packageName)).toBe(false);
    expect(passesShapedGate('Your account was debited N25,000 to Jane Doe.')).toBe(true);
    const candidate = parseNotificationCandidate(
      { id: 'sms-debit', packageName: smsFallback.packageName, text: 'Your account was debited N25,000 to Jane Doe.', receivedAt: 31 },
      smsFallback,
    );
    expect(candidate).toMatchObject({ merchant: 'Jane Doe', amount: 25000, currency: 'NGN' });
  });

  it('ignores an unlisted package with an amount but no transaction keyword', () => {
    expect(passesShapedGate('Your reward of $42.80 at Whole Foods Market is ready.')).toBe(false);
    const outcome = createNotificationParser(parseNotificationCandidate).parse(
      { ...notification, packageName: smsFallback.packageName, text: 'Your reward of $42.80 at Whole Foods Market is ready.' },
      smsFallback,
    );
    expect(outcome).toEqual({ status: 'ignored', code: 'not_transaction' });
    expect(JSON.stringify(outcome)).not.toContain('Whole Foods');
  });

  it('yields exactly one event when registry and shape match the same notification', () => {
    const adapter = fakeAdapter();
    const events: unknown[] = [];
    const sourceAdapter = createParsedAutoCaptureSource(adapter, createNotificationParser(parseNotificationCandidate), [source, opaySource]);
    sourceAdapter.setLifecycle?.(true, 'granted');
    sourceAdapter.subscribe(event => events.push(event));
    adapter.emit({
      id: 'dual-match', packageName: opaySource.packageName, title: 'Credit alert',
      text: 'Your OPay account was credited with N25,000 from Jane Doe.', receivedAt: 32,
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ candidate: { merchant: 'Jane Doe', amount: 25000, source: 'auto_capture' } });
  });

  it('forwards shaped fallback traffic through the same parse call with no invented name', () => {
    const adapter = fakeAdapter();
    const events: unknown[] = [];
    const sourceAdapter = createParsedAutoCaptureSource(adapter, createNotificationParser(parseNotificationCandidate), [opaySource]);
    sourceAdapter.setLifecycle?.(true, 'granted');
    sourceAdapter.subscribe(event => events.push(event));
    adapter.emit({
      id: 'sms-shaped', packageName: smsFallback.packageName,
      text: 'Your account was debited N25,000 to Jane Doe.', receivedAt: 33,
    });
    adapter.emit({
      id: 'sms-noise', packageName: smsFallback.packageName,
      text: 'Your reward of $42.80 at Whole Foods Market is ready.', receivedAt: 34,
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      candidate: { merchant: 'Jane Doe', amount: 25000, note: 'Detected from smsapp' },
    });
  });

  it('gives shaped fallback packages no registry row', () => {
    expect(filterSupportedSources([smsFallback], new Set([smsFallback.packageName]))).toEqual([]);
  });
});

// Phase 16 D1 pins (brief section 3 fixtures, masked exactly as shown, never
// unmasked or expanded). Direction plus Nigerian field parsing plus friendly
// names share the extractors above, so these pin the contract Mobile M2 and
// M3 build against.
describe('phase 16 direction plus Nigerian field parsing plus friendly names', () => {
  // Kingsley device evidence, 2026-11-09, account digits masked as recorded.
  const OPAY_DEBIT_SMS = 'DEBIT ALERT Acc:907****170 Amt:NGN2,000.00 Bal:NGN77,199.58 Date:09-Nov-2026 16:18 Des:For Transfer Via E-Channel Dial *955*100# to cancel SMS Alerts';
  const UBA_CREDIT_SMS = 'Txn:CR Ac:2XX..31X Amt:NGN 2,000.00 Des:TNF-KINGSLEY UZOMA ONUOHA/Transfer from KINGSLEY U Date:09-11-2026 16:18 Bal:NGN 9,693.60';

  const smsSource: AutoCaptureSourceDescriptor = {
    id: 'com.android.mms', packageName: 'com.android.mms', displayName: 'com.android.mms', status: 'active',
  };

  it('routes the OPay debit fixture to an expense with a non footer merchant', () => {
    const detected = parseAutoCaptureDetection(
      { id: 'opay-debit-device', packageName: opaySource.packageName, text: OPAY_DEBIT_SMS, receivedAt: 100 },
      opaySource,
    );
    expect(detected).not.toBeNull();
    expect(detected?.direction).toBe('debit');
    expect(detected?.kind).toBe('expense');
    if (detected?.kind !== 'expense') return;
    expect(detected.candidate).toMatchObject({
      merchant: 'Transfer Via E-Channel',
      amount: 2000,
      currency: 'NGN',
      category: 'other',
      date: 100,
      source: 'auto_capture',
      origin: 'auto_capture',
      note: 'Detected from OPay',
    });
    expect(detected.candidate.merchant.toLowerCase()).not.toContain('cancel');
    expect(detected.candidate.merchant.toLowerCase()).not.toContain('sms alert');
  });

  it('routes the UBA credit fixture to an income candidate with the sender as sourceName', () => {
    const detected = parseAutoCaptureDetection(
      { id: 'uba-credit-device', packageName: smsSource.packageName, text: UBA_CREDIT_SMS, receivedAt: 200 },
      smsSource,
    );
    expect(detected).not.toBeNull();
    expect(detected?.direction).toBe('credit');
    expect(detected?.kind).toBe('income');
    if (detected?.kind !== 'income') return;
    expect(detected.candidate).toMatchObject({
      sourceName: 'KINGSLEY U',
      amount: 2000,
      currency: 'NGN',
      category: AUTO_CAPTURE_INCOME_CATEGORY,
      date: 200,
      source: 'auto_capture',
      origin: 'auto_capture',
      note: 'Detected from Messages',
    });
  });

  it('keeps an ambiguous direction as expense and notes the ambiguity', () => {
    expect(detectTransferDirection('NGN 25,000 at Shoprite')).toBe('ambiguous');
    const detected = parseAutoCaptureDetection(
      { id: 'ambiguous', packageName: source.packageName, text: 'NGN 25,000 at Shoprite', receivedAt: 300 },
      source,
    );
    expect(detected?.direction).toBe('ambiguous');
    expect(detected?.kind).toBe('expense');
    if (detected?.kind !== 'expense') return;
    expect(detected.candidate).toMatchObject({ merchant: 'Shoprite', amount: 25000, currency: 'NGN' });
    expect(detected.candidate.note).toContain('direction unclear, kept as expense');
  });

  it('marks text with both debit and credit signals ambiguous, never a guessed direction', () => {
    expect(detectTransferDirection('Txn:DR debit then Txn:CR credit on one line')).toBe('ambiguous');
    expect(detectTransferDirection('DEBIT ALERT Acc:907****170 Amt:NGN2,000.00')).toBe('debit');
    expect(detectTransferDirection('Txn:CR Ac:2XX..31X Amt:NGN 2,000.00')).toBe('credit');
  });

  it('yields no merchant from footer only text instead of footer garbage', () => {
    const footerOnly = 'Debit alert Amt:NGN2,000.00 Des:Dial *955*100# to cancel SMS Alerts Date:09-Nov-2026';
    expect(parseAutoCaptureDetection(
      { id: 'footer-only', packageName: source.packageName, text: footerOnly, receivedAt: 400 },
      source,
    )).toBeNull();
    expect(parseNotificationCandidate(
      { id: 'footer-only-legacy', packageName: source.packageName, text: footerOnly, receivedAt: 400 },
      source,
    )).toBeNull();
  });

  it('resolves friendly source names and falls back to the short package tail', () => {
    expect(resolveSourceDisplayName('com.android.mms')).toBe('Messages');
    expect(resolveSourceDisplayName('team.opay.pay')).toBe('OPay');
    expect(resolveSourceDisplayName('com.ubanquity.redd.uba')).toBe('UBA Mobile App');
    expect(resolveSourceDisplayName('com.example.smsapp')).toBe('smsapp');
    expect(resolveSourceDisplayName('  ')).toBe('Payment app');
  });
});
