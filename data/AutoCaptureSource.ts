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
// Named registry (Phase 13, FR-22.2). One row per verified banking app; the
// package ID is the Play Store listing ID, never invented. Display names match
// the Kotlin supportedPackages plus displayNames exactly; QA verifies parity.
const ALLOWED_SOURCE_METADATA: Readonly<Record<string, { packageName: string; displayName: string }>> = Object.freeze({
  'google-wallet': { packageName: 'com.google.android.apps.walletnfcrel', displayName: 'Google Wallet' },
  chase: { packageName: 'com.chase.sig.android', displayName: 'Chase Mobile' },
  paypal: { packageName: 'com.paypal.android.p2pmobile', displayName: 'PayPal' },
  'cash-app': { packageName: 'com.squareup.cash', displayName: 'Cash App' },
  // Nigerian commercial banks (brief section 4, Play Store verified).
  'access-bank': { packageName: 'com.accessbank.nextgen', displayName: 'Access Bank' },
  'first-bank': { packageName: 'com.firstbank.firstmobile', displayName: 'First Bank' },
  gtbank: { packageName: 'com.gtbank.gtworldv1', displayName: 'GTBank' },
  uba: { packageName: 'com.uba.vericash', displayName: 'UBA' },
  'uba-mobile-app': { packageName: 'com.ubanquity.redd.uba', displayName: 'UBA Mobile App' },
  'zenith-bank': { packageName: 'com.zenithBank.eazymoney', displayName: 'Zenith Bank' },
  'fidelity-bank': { packageName: 'com.interswitchng.www', displayName: 'Fidelity Bank' },
  fcmb: { packageName: 'com.appzonegroup.fcmb', displayName: 'FCMB' },
  'union-bank': { packageName: 'com.ceva.ubmobile.stallion', displayName: 'Union Bank' },
  'sterling-bank': { packageName: 'com.sterlingng.sterlingmobile', displayName: 'Sterling Bank' },
  'wema-alat': { packageName: 'com.wemabank.alat.prod', displayName: 'ALAT by Wema' },
  'stanbic-ibtc': { packageName: 'com.StanbicMobile', displayName: 'Stanbic IBTC' },
  ecobank: { packageName: 'com.app.ecobank', displayName: 'Ecobank' },
  'ecobank-mobile': { packageName: 'com.ecobank.mobileapp5', displayName: 'Ecobank Mobile' },
  // Nigerian fintech (brief section 4, Play Store verified).
  opay: { packageName: 'team.opay.pay', displayName: 'OPay' },
  palmpay: { packageName: 'com.transsnet.palmpay', displayName: 'PalmPay' },
  moniepoint: { packageName: 'com.moniepoint.personal', displayName: 'Moniepoint' },
  'moniepoint-business': { packageName: 'com.moniepoint.business', displayName: 'Moniepoint Business' },
  kuda: { packageName: 'com.kudabank.app', displayName: 'Kuda' },
  carbon: { packageName: 'com.lenddo.mobile.paylater', displayName: 'Carbon' },
  fairmoney: { packageName: 'ng.com.fairmoney.fairmoney', displayName: 'FairMoney' },
  paga: { packageName: 'com.mypaga.customer', displayName: 'Paga' },
  'chipper-cash': { packageName: 'com.chippercash', displayName: 'Chipper Cash' },
  vbank: { packageName: 'com.vfd.app', displayName: 'Vbank' },
});

const REGISTRY_PACKAGE_NAMES: ReadonlySet<string> = new Set(
  Object.values(ALLOWED_SOURCE_METADATA).map(metadata => metadata.packageName),
);

export function isRegistryPackage(packageName: string): boolean {
  return REGISTRY_PACKAGE_NAMES.has(packageName);
}

// Shaped fallback gate (FR-SHNEW.1, brief section 4). A notification from a
// package outside the named registry parses only when its combined title plus
// text carries a debit or credit keyword plus a parseable amount plus a
// merchant. Stems cover the brief word families: debit covers debited, credit
// covers credited, transact covers transaction, pay covers paid and payment,
// receiv covers receive and received, withdraw covers withdrawal, spend covers
// spend while spent is listed outright, and balance counts only with the
// separately required amount (a balance alert with movement). Registry
// packages parse as today with no keyword required.
const SHAPED_KEYWORD_PATTERN = /\b(debit|credit|spend|spent|pay|receiv|sent|transfer|withdraw|deposit|transact|balance)\w*/i;

export function passesShapedGate(text: string): boolean {
  return SHAPED_KEYWORD_PATTERN.test(text);
}

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
  // Allowlist gate with honest status pass through (FR-22.2). An unknown id
  // never invents a friendly name, a package mismatch never passes, and the
  // status Mobile supplies (active or not_detected) is preserved so S-22 can
  // render Not detected. Shaped fallback packages carry no registry row and
  // need none: they never reach this filter with a fabricated id.
  return sources.flatMap(source => {
    const metadata = ALLOWED_SOURCE_METADATA[source.id];
    if (!metadata || metadata.packageName !== source.packageName || !packageNames.has(source.packageName)) return [];
    return [{ id: source.id, packageName: metadata.packageName, displayName: metadata.displayName, status: source.status }];
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
  const supported = filterSupportedSources(sources, new Set(sources.map(source => source.packageName)));
  // Only an active source can emit: not_detected rows pass through the filter
  // above for S-22 rendering but never join the subscription map.
  const activeSources = supported.filter(source => source.status === 'active');
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
      // Single pipeline (FR-SHNEW.2): one notification yields at most one
      // draft. A named registry package resolves to its descriptor; any other
      // package gets a synthetic descriptor carrying its real package name
      // (no invented friendly name) so the same parse call applies the shaped
      // gate to it. The registry match and the shape match are OR conditions
      // inside parseNotificationCandidate, never two pipelines.
      unsubscribe = adapter.subscribe(notification => {
        if (!lifecycleEnabled) return;
        if (!isSafeNotification(notification)) return;
        const source = byPackage.get(notification.packageName) ?? {
          id: notification.packageName,
          packageName: notification.packageName,
          displayName: notification.packageName,
          status: 'active' as const,
        };
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

// Amount core: thousands-grouped first (5,000 or 12,500.00), then a plain
// integer or dot-decimal, then a comma-decimal. Order matters so a grouped
// value is never truncated to its leading digits.
const AMOUNT_CORE = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?|\d+,\d{1,2}`;
// Currency tokens the parser recognises as patterns, never as fixture values.
// Bare N matches only directly before a digit (N5,000), so ordinary words are
// never treated as Naira. Suffix form omits bare N, which has no suffix use.
const AMOUNT_PREFIX = String.raw`(?:[$€£₦]|USD|EUR|GBP|NGN|N(?=\s*\d))`;
const AMOUNT_SUFFIX = String.raw`(?:[$€£₦]|USD|EUR|GBP|NGN)`;
const PREFIX_AMOUNT_PATTERN = new RegExp(`${AMOUNT_PREFIX}\\s*(${AMOUNT_CORE})`, 'i');
const SUFFIX_AMOUNT_PATTERN = new RegExp(`(${AMOUNT_CORE})\\s*${AMOUNT_SUFFIX}`, 'i');
// Merchant follows at, to, or from as whole words, so a syllable inside a name
// can never split it. Trailing context starting with on, with, or using, or a
// sentence boundary, ends the capture.
const MERCHANT_PATTERN = /\b(?:at|to|from)\b\s+([^.;|]+?)(?:\s+(?:on|with|using)\b|[.;|]|$)/i;

function normalizeGroupedAmount(raw: string): number | null {
  const value = raw.trim();
  if (!value) return null;
  let canonical: string;
  if (value.includes('.') && value.includes(',')) canonical = value.replace(/,/g, '');
  else if (value.includes(',') && /^\d{1,3}(?:,\d{3})+$/.test(value)) canonical = value.replace(/,/g, '');
  else if (value.includes(',')) canonical = value.replace(',', '.');
  else canonical = value;
  const parsed = Number(canonical);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function parseNotificationCandidate(
  notification: NativeAutoCaptureNotification,
  source: AutoCaptureSourceDescriptor,
  userCurrency?: string | null,
): CaptureCandidate | null {
  // Combined title plus text signal. Title is optional: a missing title reads
  // as an empty prefix, never a crash. Neither field alone is required; text
  // carries the match when the title is absent and the title can carry the
  // merchant when the body holds only the amount. Debit and credit phrasing
  // both parse through the same amount plus merchant shape; direction is
  // decided at the confirm sheet, not here. Packages outside the named
  // registry must additionally pass the shaped gate (FR-SHNEW.1): a
  // transaction keyword plus the amount plus the merchant below.
  const text = `${notification.title ?? ''} ${notification.text}`.trim();
  if (!isRegistryPackage(source.packageName) && !passesShapedGate(text)) return null;
  const amountToken = text.match(PREFIX_AMOUNT_PATTERN)?.[1] ?? text.match(SUFFIX_AMOUNT_PATTERN)?.[1];
  if (!amountToken) return null;
  const amount = normalizeGroupedAmount(amountToken);
  if (amount === null) return null;
  const merchantMatch = text.match(MERCHANT_PATTERN);
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

// Native parity rule, recorded exactly: reject when the id, package name, or
// non-blank text is missing, when the combined title plus text exceeds 280
// chars, when the combined signal contains a URL (http://, https://, www.) or
// a card or account identifier (card/account followed by an ending, number, or
// digit run, or any 13 to 19 digit run), or when receivedAt is not a positive
// finite timestamp. Plain amounts are never stripped or redacted; the check
// only rejects, and a rejection returns null without logging raw text. This
// mirrors the corrected Kotlin sanitizer, which must apply the same bound and
// the same URL and identifier rejections and must not delete digit runs that
// form real amounts.
function isSafeNotification(notification: NativeAutoCaptureNotification): boolean {
  const combined = `${notification.title ?? ''} ${notification.text}`;
  if (!notification.id || !notification.packageName || !notification.text.trim()) return false;
  if (combined.length > MAX_NOTIFICATION_TEXT || /https?:\/\/|www\.|\b(?:card|account)\s*(?:ending|number|no\.?|#)?\s*\d{2,}|\b\d{13,19}\b/i.test(combined)) return false;
  return notification.receivedAt > 0 && Number.isFinite(notification.receivedAt);
}

function inferCurrency(text: string, userCurrency?: string | null): string {
  if (/€|EUR/i.test(text)) return 'EUR';
  if (/£|GBP/i.test(text)) return 'GBP';
  if (/₦|NGN/i.test(text) || /(?:^|\s)N(?=\s*\d)/.test(text)) return 'NGN';
  if (/\$|USD/i.test(text)) return 'USD';
  return resolveUserCurrency(userCurrency);
}

export function getUnavailableReason(): string { return UNAVAILABLE_REASON; }
