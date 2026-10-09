import { v4 as uuid } from 'uuid';
import type {
  AutoCaptureCapability,
  AutoCaptureEvent,
  AutoCaptureEventSource,
  AutoCapturePermissionState,
  AutoCaptureSourceDescriptor,
  CaptureCandidate,
  NativeAutoCaptureNotification,
  NativeAutoCaptureSourceAdapter,
} from './contracts';
import { resolveUserCurrency } from '../utils/currency';

export type NotificationParseOutcome =
  | { status: 'parsed'; event: AutoCaptureEvent }
  | { status: 'ignored'; code: 'unsupported_source' | 'not_transaction' }
  | { status: 'failed'; code: 'invalid_notification' };

export interface NotificationParser {
  parse(notification: NativeAutoCaptureNotification, source: AutoCaptureSourceDescriptor): NotificationParseOutcome;
}

const UNAVAILABLE_REASON = 'Optional Android notification source is not installed';
const MAX_NOTIFICATION_TEXT = 280;
const ALLOWED_SOURCE_METADATA: Readonly<Record<string, { packageName: string; displayName: string }>> = Object.freeze({
  'google-wallet': { packageName: 'com.google.android.apps.walletnfcrel', displayName: 'Google Wallet' },
  chase: { packageName: 'com.chase.sig.android', displayName: 'Chase Mobile' },
  paypal: { packageName: 'com.paypal.android.p2pmobile', displayName: 'PayPal' },
  'cash-app': { packageName: 'com.squareup.cash', displayName: 'Cash App' },
});

class UnavailableAutoCaptureSourceAdapter implements NativeAutoCaptureSourceAdapter {
  readonly capability: AutoCaptureCapability;
  readonly platform: 'android' | 'ios';

  constructor(platform: 'android' | 'ios') {
    this.platform = platform;
    this.capability = platform === 'ios' ? 'unsupported' : 'unavailable';
  }

  async getPermissionState(): Promise<AutoCapturePermissionState> {
    return { status: 'unsupported', canRequest: false };
  }

  async getSupportedSources(): Promise<AutoCaptureSourceDescriptor[]> { return []; }
  subscribe(): () => void { return () => undefined; }
  async openSystemSettings(): Promise<void> { return undefined; }
}

export function createOptionalAutoCaptureSourceAdapter(
  platform: 'android' | 'ios',
  nativeAdapter?: NativeAutoCaptureSourceAdapter,
): NativeAutoCaptureSourceAdapter {
  if (platform !== 'android') return new UnavailableAutoCaptureSourceAdapter(platform);
  return nativeAdapter ?? new UnavailableAutoCaptureSourceAdapter(platform);
}

export function filterSupportedSources(
  sources: AutoCaptureSourceDescriptor[],
  packageNames: ReadonlySet<string>,
): AutoCaptureSourceDescriptor[] {
  return sources.flatMap(source => {
    const metadata = ALLOWED_SOURCE_METADATA[source.id];
    if (!metadata || metadata.packageName !== source.packageName || !packageNames.has(source.packageName) || source.status !== 'active') return [];
    return [{ id: source.id, ...metadata, status: 'active' as const }];
  });
}

export function createNotificationParser(
  parse: (notification: NativeAutoCaptureNotification, source: AutoCaptureSourceDescriptor) => CaptureCandidate | null,
): NotificationParser {
  return {
    parse(notification, source) {
      if (!isSafeNotification(notification)) return { status: 'failed', code: 'invalid_notification' };
      const candidate = parse(notification, source);
      if (!candidate) return { status: 'ignored', code: 'not_transaction' };
      return { status: 'parsed', event: { id: notification.id || uuid(), receivedAt: notification.receivedAt, candidate } };
    },
  };
}

export function createParsedAutoCaptureSource(
  adapter: NativeAutoCaptureSourceAdapter,
  parser: NotificationParser,
  sources: AutoCaptureSourceDescriptor[],
): AutoCaptureEventSource {
  const activeSources = filterSupportedSources(sources, new Set(sources.filter(source => source.status === 'active').map(source => source.packageName)));
  const byPackage = new Map(activeSources.map(source => [source.packageName, source]));
  let lifecycleEnabled = false;
  let unsubscribe: (() => void) | null = null;
  return {
    capability: adapter.capability,
    setLifecycle(enabled, permission) {
      lifecycleEnabled = enabled && permission === 'granted';
      adapter.setLifecycle?.(enabled, permission);
      if (!lifecycleEnabled) unsubscribe?.();
    },
    subscribe(listener) {
      if (!lifecycleEnabled) return () => undefined;
      unsubscribe = adapter.subscribe(notification => {
        if (!lifecycleEnabled) return;
        if (!isSafeNotification(notification)) return;
        const source = byPackage.get(notification.packageName);
        if (!source) return;
        const outcome = parser.parse(notification, source);
        if (outcome.status === 'parsed') listener(outcome.event);
      });
      return () => {
        unsubscribe?.();
        unsubscribe = null;
      };
    },
  };
}

export function parseNotificationCandidate(
  notification: NativeAutoCaptureNotification,
  source: AutoCaptureSourceDescriptor,
  userCurrency?: string | null,
): CaptureCandidate | null {
  const text = `${notification.title ?? ''} ${notification.text}`.trim();
  const amountMatch = text.match(/(?:[$€£]|USD|EUR|GBP)\s*(\d+(?:[.,]\d{1,2})?)/i)
    ?? text.match(/(\d+(?:[.,]\d{1,2})?)\s*(?:USD|EUR|GBP|[$€£])/i);
  if (!amountMatch) return null;
  const amount = Number(amountMatch[1].replace(',', '.'));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const merchantMatch = text.match(/(?:at|to|from)\s+([^.;|]+?)(?:\s+(?:on|with|using)\b|[.;|]|$)/i);
  const merchant = merchantMatch?.[1]?.trim();
  if (!merchant) return null;
  return {
    merchant,
    amount,
    currency: inferCurrency(text, userCurrency),
    category: 'other',
    date: notification.receivedAt,
    source: 'auto_capture',
    origin: 'auto_capture',
    note: `Detected from ${source.displayName}`,
  };
}

export function sanitizeNativeNotification(notification: NativeAutoCaptureNotification): NativeAutoCaptureNotification | null {
  if (!isSafeNotification(notification)) return null;
  return { id: notification.id.slice(0, 100), packageName: notification.packageName, text: notification.text.trim(), title: notification.title?.trim(), receivedAt: notification.receivedAt };
}

function isSafeNotification(notification: NativeAutoCaptureNotification): boolean {
  const combined = `${notification.title ?? ''} ${notification.text}`;
  if (!notification.id || !notification.packageName || !notification.text.trim()) return false;
  if (combined.length > MAX_NOTIFICATION_TEXT || /https?:\/\/|www\.|\b(?:card|account)\s*(?:ending|number|no\.?|#)?\s*\d{2,}|\b\d{13,19}\b/i.test(combined)) return false;
  return notification.receivedAt > 0 && Number.isFinite(notification.receivedAt);
}

function inferCurrency(text: string, userCurrency?: string | null): string {
  if (/€|EUR/i.test(text)) return 'EUR';
  if (/£|GBP/i.test(text)) return 'GBP';
  return resolveUserCurrency(userCurrency);
}

export function getUnavailableReason(): string { return UNAVAILABLE_REASON; }
