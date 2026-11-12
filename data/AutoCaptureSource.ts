import { v4 as uuid } from 'uuid';
import type {
  AutoCaptureCapability,
  AutoCaptureEvent,
  AutoCaptureEventSource,
  AutoCapturePermissionState,
  AutoCaptureSourceDescriptor,
  AutostartGuideEntry,
  CaptureCandidate,
  IncomeCandidate,
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

  // Honest fallback where the native guard has no meaning: exemption never
  // claimed, guard never reported running, battery screen is a no op.
  async getBatteryExemption(): Promise<{ exempt: boolean }> { return { exempt: false }; }
  async getGuardState(): Promise<{ running: boolean; captureEnabled: boolean; listenerGranted: boolean }> {
    return { running: false, captureEnabled: false, listenerGranted: false };
  }
  async openBatterySettings(): Promise<void> { return undefined; }

  // Phase 14 M2 honest fallbacks where the native alert has no meaning: the
  // device ping is never posted, the drain is always empty, and no listener
  // is ever registered, so iOS and Expo Go keep inbox only behavior.
  async showDetectionAlert(): Promise<{ posted: boolean }> { return { posted: false }; }
  async cancelDetectionAlert(): Promise<void> { return undefined; }
  subscribeAlertActions(): () => void { return () => undefined; }
  async consumePendingAlertAction(): Promise<null> { return null; }
  async consumePendingNativeDetections(): Promise<null> { return null; }
  async openAutostartSettings(): Promise<boolean> { return false; }
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
          displayName: resolveSourceDisplayName(notification.packageName),
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

// Phase 16 D1 direction plus Nigerian field parsing plus friendly names
// (brief section 4, FR-SHNEW.1, FR-SHNEW.2, FR-SHNEW.4). One shared extractor
// set serves both the legacy expense parse below and the directed parse, so
// there is exactly one merchant implementation, never two.
export type AutoCaptureDirection = 'debit' | 'credit' | 'ambiguous';

export type ParsedAutoCaptureDetection =
  | { direction: 'debit' | 'ambiguous'; kind: 'expense'; candidate: CaptureCandidate }
  | { direction: 'credit'; kind: 'income'; candidate: IncomeCandidate };

// Income fallback category. Matches the income.category schema default from
// migration 5 and the expense fallback the parser already uses, so an
// unremembered auto-capture never invents a category name.
export const AUTO_CAPTURE_INCOME_CATEGORY = 'other';

const DEBIT_SIGNAL_PATTERN = /\btxn\s*:\s*dr\b|\bdebit(?:ed)?\b|\bsent\b|\bpaid\b|\bspent\b/i;
const CREDIT_SIGNAL_PATTERN = /\btxn\s*:\s*cr\b|\bcredit(?:ed)?\b|\breceived\b/i;

export function detectTransferDirection(text: string): AutoCaptureDirection {
  const debit = DEBIT_SIGNAL_PATTERN.test(text);
  const credit = CREDIT_SIGNAL_PATTERN.test(text);
  if (debit && !credit) return 'debit';
  if (credit && !debit) return 'credit';
  return 'ambiguous';
}

// Nigerian bank SMS shape (brief section 3 fixtures). Fields arrive as
// Key:value pairs on one line, so Des runs until the next known key or the
// end. acc precedes ac so Acc: never truncates to its first two letters.
const DES_FIELD_PATTERN = /\bdes\s*:\s*([\s\S]*?)(?=\b(?:acc|amt|bal|date|txn|time|ref|narration|ac)\s*:|$)/i;

function extractDesField(text: string): string | null {
  const value = text.match(DES_FIELD_PATTERN)?.[1]?.trim();
  return value ? value : null;
}

// Footer starts, in order of the fixtures: a Dial plus star code clause, a
// cancel tail, and a Loan plus question promo. cleanDesValue cuts the Des
// value at the first marker, so footer copy never reaches the merchant.
// stripSmsFooters applies the same cuts plus balance only segments to the
// whole text before the generic at/to/from fallback runs.
function cleanDesValue(raw: string): string {
  const cutAt = raw.search(/\bDial\s*\*|\bto\s+cancel\b|\bcancel\s+SMS\b|\bLoan\?/i);
  const truncated = (cutAt >= 0 ? raw.slice(0, cutAt) : raw).replace(/\s+/g, ' ').trim();
  return truncated.replace(/^For\s+/i, '');
}

function isFooterText(value: string): boolean {
  return /\bDial\s*\*|\bcancel\s+SMS\b|\bLoan\?/i.test(value);
}

function isBalanceOnlySegment(segment: string): boolean {
  return /^\s*(?:Bal|Avl\.?\s*Bal|Available\s+Bal(?:ance)?)\s*:?\s*(?:[A-Z]{0,3}\s?)?[\d,.]+\s*$/i.test(segment);
}

function stripSmsFooters(text: string): string {
  const withoutClauses = text
    .replace(/\bDial\s*\*[\d*]*(?:\*[\d*]+)*#?[^\n;|]*/gi, ' ')
    .replace(/\bto\s+cancel\s+SMS\s+Alerts?[^\n;|]*/gi, ' ')
    .replace(/\bcancel\s+SMS\s+Alerts?[^\n;|]*/gi, ' ')
    .replace(/\bLoan\?[^\n;|]*/gi, ' ');
  return withoutClauses
    .split(/[|\n]/)
    .filter(segment => !isBalanceOnlySegment(segment))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Des first, generic fallback second. A Des value that is only footer residue
// falls through to the generic path, which runs on footer stripped text, so
// footer only text yields no merchant instead of footer garbage.
function resolveDesMerchant(desValue: string | null, strippedText: string): string | null {
  if (desValue) {
    const cleaned = cleanDesValue(desValue);
    if (cleaned && !isFooterText(cleaned)) {
      const inner = cleaned.match(MERCHANT_PATTERN)?.[1]?.trim();
      if (inner && !isFooterText(inner)) return inner;
      return cleaned;
    }
  }
  const generic = strippedText.match(MERCHANT_PATTERN)?.[1]?.trim();
  return generic || null;
}

// Income sender, read from the Des value first. Transfer from NAME is the
// primary cue; without it the segment before the slash minus its code prefix
// is the fallback; without either the generic merchant stands in.
function extractIncomeSourceName(desValue: string | null, fallbackMerchant: string | null): string | null {
  if (desValue) {
    const fromMatch = desValue.match(/\bfrom\s+([^/;|]+?)\s*$/i)?.[1]?.trim();
    if (fromMatch) return fromMatch;
    const firstSegment = desValue.split('/')[0].trim().replace(/^[A-Z]{2,}-/, '');
    if (firstSegment) return firstSegment;
  }
  return fallbackMerchant;
}

const PACKAGE_TO_DISPLAY_NAME: ReadonlyMap<string, string> = new Map(
  Object.values(ALLOWED_SOURCE_METADATA).map(metadata => [metadata.packageName, metadata.displayName]),
);

// System packages outside the banking registry that still deliver bank SMS.
// com.android.mms renders Messages. Anything else unknown renders the short
// package tail, never invented branding. An empty package is not a name, so
// it reads as the same generic label the alert service already uses.
const SYSTEM_PACKAGE_DISPLAY_NAMES: Readonly<Record<string, string>> = Object.freeze({
  'com.android.mms': 'Messages',
});

export function resolveSourceDisplayName(packageName: string): string {
  const clean = packageName.trim();
  if (!clean) return 'Payment app';
  const registry = PACKAGE_TO_DISPLAY_NAME.get(clean);
  if (registry) return registry;
  const system = SYSTEM_PACKAGE_DISPLAY_NAMES[clean];
  if (system) return system;
  return clean.split('.').filter(Boolean).pop() ?? clean;
}

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
  // Legacy expense only entry, kept for pipeline compatibility (FR-SHNEW.2):
  // the host and the confirm sheet still consume CaptureCandidate, so this
  // keeps its signature and expense shape. New work uses
  // parseAutoCaptureDetection, which shares every extractor below and adds
  // direction routing. Debit and credit phrasing both parse through the same
  // amount plus merchant shape; direction is routed by the directed parse,
  // not here. Packages outside the named registry must additionally pass the
  // shaped gate (FR-SHNEW.1): a transaction keyword plus the amount plus the
  // merchant below.
  const text = `${notification.title ?? ''} ${notification.text}`.trim();
  if (!isRegistryPackage(source.packageName) && !passesShapedGate(text)) return null;
  const stripped = stripSmsFooters(text);
  const amountToken = stripped.match(PREFIX_AMOUNT_PATTERN)?.[1] ?? stripped.match(SUFFIX_AMOUNT_PATTERN)?.[1];
  if (!amountToken) return null;
  const amount = normalizeGroupedAmount(amountToken);
  if (amount === null) return null;
  const merchant = resolveDesMerchant(extractDesField(stripped), stripped);
  if (!merchant) return null;
  return {
    merchant,
    amount,
    currency: inferCurrency(stripped, userCurrency),
    category: 'other',
    date: notification.receivedAt,
    source: 'auto_capture',
    origin: 'auto_capture',
    note: `Detected from ${resolveSourceDisplayName(source.packageName)}`,
  };
}

// Phase 16 D1 directed parse (brief section 4, FR-SHNEW.4). Debit routes to
// an expense candidate exactly as the legacy parse above; credit routes to an
// income candidate with the sender as sourceName, the income category
// default, the notification time as date, and origin auto_capture for the
// shared saveIncome boundary. Ambiguous text keeps expense behavior and
// records the ambiguity in the note, never a guessed direction. Returns null
// for unparseable text (no amount, no merchant, no sender) exactly like the
// legacy parse, so the notification parser keeps its ignored outcome.
export function parseAutoCaptureDetection(
  notification: NativeAutoCaptureNotification,
  source: AutoCaptureSourceDescriptor,
  userCurrency?: string | null,
): ParsedAutoCaptureDetection | null {
  const text = `${notification.title ?? ''} ${notification.text}`.trim();
  if (!isRegistryPackage(source.packageName) && !passesShapedGate(text)) return null;
  const stripped = stripSmsFooters(text);
  const amountToken = stripped.match(PREFIX_AMOUNT_PATTERN)?.[1] ?? stripped.match(SUFFIX_AMOUNT_PATTERN)?.[1];
  if (!amountToken) return null;
  const amount = normalizeGroupedAmount(amountToken);
  if (amount === null) return null;
  const currency = inferCurrency(stripped, userCurrency);
  const displayName = resolveSourceDisplayName(source.packageName);
  const desValue = extractDesField(stripped);
  const direction = detectTransferDirection(stripped);
  if (direction === 'credit') {
    const sourceName = extractIncomeSourceName(desValue, resolveDesMerchant(desValue, stripped));
    if (!sourceName) return null;
    return {
      direction,
      kind: 'income',
      candidate: {
        sourceName,
        amount,
        currency,
        category: AUTO_CAPTURE_INCOME_CATEGORY,
        date: notification.receivedAt,
        note: `Detected from ${displayName}`,
        source: 'auto_capture',
        origin: 'auto_capture',
      },
    };
  }
  const merchant = resolveDesMerchant(desValue, stripped);
  if (!merchant) return null;
  return {
    direction,
    kind: 'expense',
    candidate: {
      merchant,
      amount,
      currency,
      category: 'other',
      date: notification.receivedAt,
      source: 'auto_capture',
      origin: 'auto_capture',
      note: direction === 'ambiguous'
        ? `Detected from ${displayName} (direction unclear, kept as expense)`
        : `Detected from ${displayName}`,
    },
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

// Phase 14 M1 autostart guide. Android exposes no API that reports whether an
// OEM autostart manager allows this app, so every row is static instructions
// written from public settings paths, never a sensed state. The guide always
// opens with the generic row; brand rows narrow the path where the location
// differs. No row claims the app verified anything on device.
export const AUTOSTART_GUIDE: readonly AutostartGuideEntry[] = Object.freeze([
  {
    brand: 'Generic Android',
    systemPath: 'Settings > Apps > PeachSpend > Battery',
    steps: [
      'Open Settings, then Apps, then PeachSpend.',
      'Open Battery and choose Unrestricted.',
      'If the phone maker list below matches this device, follow that row too.',
    ],
  },
  {
    brand: 'Samsung',
    systemPath: 'Settings > Battery > Background usage limits',
    steps: [
      'Open Settings, then Battery, then Background usage limits.',
      'Make sure PeachSpend is not in Sleeping apps or Deep sleeping apps.',
      'Open Settings, then Apps, then PeachSpend, then Battery, and choose Unrestricted.',
    ],
  },
  {
    brand: 'Xiaomi',
    systemPath: 'Settings > Apps > Manage apps > PeachSpend',
    steps: [
      'Open Settings, then Apps, then Manage apps, then PeachSpend.',
      'Turn on Autostart.',
      'Open Battery saver and choose No restrictions.',
    ],
  },
  {
    brand: 'Huawei',
    systemPath: 'Settings > Battery > App launch',
    steps: [
      'Open Settings, then Battery, then App launch.',
      'Turn off Manage automatically for PeachSpend.',
      'Turn on Auto-launch, Secondary launch, and Run in background, then confirm.',
    ],
  },
  {
    brand: 'Oppo and Realme',
    systemPath: 'Settings > Apps > PeachSpend > Battery usage',
    steps: [
      'Open Settings, then Apps, then PeachSpend.',
      'Open Battery usage and choose Allow background activity.',
      'Open Settings, then Battery, then App auto-launch, and allow PeachSpend.',
    ],
  },
  {
    brand: 'Vivo',
    systemPath: 'Settings > Battery > Background power consumption management',
    steps: [
      'Open Settings, then Battery, then Background power consumption management.',
      'Allow PeachSpend to run in the background.',
      'Open Settings, then Apps, then PeachSpend, then Battery, and choose Unrestricted.',
    ],
  },
  {
    brand: 'OnePlus',
    systemPath: 'Settings > Apps > PeachSpend > Battery',
    steps: [
      'Open Settings, then Apps, then PeachSpend, then Battery.',
      'Choose Unrestricted or Allow background activity.',
      'Open Recent apps, pull down on PeachSpend, and lock it if the lock option appears.',
    ],
  },
]);

export function getAutostartGuide(): readonly AutostartGuideEntry[] { return AUTOSTART_GUIDE; }
