import type { Expense, Income } from '../types/database';

export type CaptureSource = 'ocr' | 'share' | 'manual' | 'chat' | 'import' | 'auto_capture';
export type CaptureOrigin = 'home' | 'scan' | 'manual_expense' | 'manual_income' | 'chat' | 'share' | 'import' | 'auto_capture';
export type CaptureEventStatus = 'detected' | 'queued' | 'confirmed' | 'discarded' | 'duplicate_skipped' | 'failed';

export interface CaptureOriginMetadata {
  source: CaptureSource;
  origin: CaptureOrigin;
  reviewed: boolean;
}

export interface CaptureCandidate {
  merchant: string;
  amount: number;
  currency: string;
  category: string;
  date: number;
  note?: string;
  imageUri?: string;
  source: CaptureSource;
  origin?: CaptureOrigin;
  scanned?: boolean;
  unitPrice?: number;
  units?: number;
  // Provider-reported OCR confidence for this item, a fraction in (0, 1].
  // Absent when the provider did not supply one; never synthesized client-side.
  confidence?: number;
  isRecurring?: boolean;
  recurrenceInterval?: string;
  recurrenceDays?: string;
  // Persisted through the shared save boundary when present, so the flag no
  // longer requires a separate post-save update. Defaults to not reimbursable.
  isReimbursable?: boolean;
}

export interface IncomeCandidate {
  source: CaptureSource;
  origin?: CaptureOrigin;
  sourceName: string;
  amount: number;
  currency: string;
  category: string;
  date: number;
  note?: string;
  isRecurring?: boolean;
  recurrenceInterval?: string;
  recurrenceDays?: string;
}

export type CaptureRequiredField = 'merchant' | 'amount' | 'currency' | 'category';

export class CaptureValidationError extends Error {
  readonly code = 'capture_validation';
  constructor(readonly field: CaptureRequiredField) {
    super(`Capture field is required: ${field}`);
    this.name = 'CaptureValidationError';
  }
}

export type IncomeRequiredField = 'sourceName' | 'amount' | 'currency' | 'category' | 'date';

export class IncomeValidationError extends Error {
  readonly code = 'income_validation';
  constructor(readonly field: IncomeRequiredField) {
    super(`Income field is required: ${field}`);
    this.name = 'IncomeValidationError';
  }
}

// Sources where the merchant is extracted from something the user did not type,
// so an absent merchant is a true absence rather than an omission. A product
// photograph normally carries no store name at all, and refusing that capture
// would block a save the user can see is correct (BUG-09-17a).
//
// Every other source keeps the merchant required. A manual entry is the case
// where the requirement is real: the user left blank a name that was asked for.
// A chat action and an imported row keep it too, and both already enforce it at
// their own boundary before a candidate is built, so this restates that rule
// rather than relaxing it.
const MERCHANT_OPTIONAL_SOURCES: readonly CaptureSource[] = ['ocr', 'share', 'auto_capture'];

export function assertValidCaptureCandidate(candidate: CaptureCandidate): void {
  if (!MERCHANT_OPTIONAL_SOURCES.includes(candidate.source) && !candidate.merchant.trim()) throw new CaptureValidationError('merchant');
  if (!Number.isFinite(candidate.amount) || candidate.amount <= 0) throw new CaptureValidationError('amount');
  if (!candidate.currency.trim()) throw new CaptureValidationError('currency');
  if (!candidate.category.trim()) throw new CaptureValidationError('category');
}

export type DuplicateMatch =
  | { existing: Expense; reason: 'merchant_amount_24h' }
  | { existing: Income; reason: 'source_amount_24h' };
export type BatchDuplicateMatch =
  | { candidateIndex: number; match: DuplicateMatch }
  | { candidateIndex: number; otherCandidateIndex: number; reason: 'same_batch_24h' };
export interface CaptureRepository {
  findDuplicate(candidate: Pick<CaptureCandidate, 'merchant' | 'amount' | 'date'>): Promise<DuplicateMatch | null>;
  findBatchDuplicates(candidates: CaptureCandidate[]): Promise<BatchDuplicateMatch[]>;
  save(candidate: CaptureCandidate, allowDuplicate?: boolean): Promise<Expense>;
  saveBatch(candidates: CaptureCandidate[], allowDuplicates?: boolean): Promise<Expense[]>;
  findIncomeDuplicate(candidate: Pick<IncomeCandidate, 'sourceName' | 'amount' | 'date'>): Promise<DuplicateMatch | null>;
  saveIncome(candidate: IncomeCandidate, allowDuplicate?: boolean): Promise<Income>;
  withTransaction<T>(operation: () => Promise<T>): Promise<T>;
  getRecurringTemplateHandoff(): RecurringTemplateHandoff;
  rememberCategory(merchant: string, category: string, source: CaptureSource): Promise<void>;
  getRememberedCategory(merchant: string): Promise<string | null>;
  recordEvent(event: CaptureEventInput): Promise<string>;
  listEvents(query?: CaptureEventQuery): Promise<CaptureEventRead[]>;
  enqueueAutoCapture(payload: CaptureCandidate): Promise<string>;
  claimQueuedAutoCaptures(now?: number): Promise<QueuedCapture[]>;
  completeQueuedAutoCapture(id: string): Promise<void>;
  failQueuedAutoCapture(id: string, errorCode: string, retryAt: number): Promise<void>;
  discardQueuedAutoCaptures(): Promise<void>;
}

export interface CaptureEventInput { source: CaptureSource; status: CaptureEventStatus; merchant?: string; amount?: number; category?: string; payload?: string; errorCode?: string; }

// Read shape for the S-22 Diagnostic Activity card (FR-22.3). Mirrors the
// capture_events audit table without exposing internal queue payloads. Dates are
// epoch milliseconds; amount stays nullable so a failed parse never renders a
// fabricated value.
export interface CaptureEventRead {
  id: string;
  source: CaptureSource;
  status: CaptureEventStatus;
  merchant: string | null;
  amount: number | null;
  category: string | null;
  errorCode: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CaptureEventQuery {
  // Bounded page size, clamped by the repository. Defaults to the recent page.
  limit?: number;
  // Epoch millisecond lower bound. Defaults to the last 30 days per FR-22.3.
  since?: number;
  // Optional source filter so a caller can scope the log without a second read.
  sources?: CaptureSource[];
}

// Typed activity state the S-22 card renders. Ready, empty, and an explicit
// unavailable outcome; the screen never invents a fixture log for the last case.
export type DiagnosticActivityState =
  | { status: 'ready'; entries: CaptureEventRead[] }
  | { status: 'empty' }
  | { status: 'unavailable'; errorCode: string };

export function buildDiagnosticActivity(entries: CaptureEventRead[]): DiagnosticActivityState {
  return entries.length > 0 ? { status: 'ready', entries } : { status: 'empty' };
}

export interface QueuedCapture { id: string; payload: CaptureCandidate; attempts: number; }

export type SaveDecision = 'confirm' | 'save_anyway' | 'discard';
export type SaveResolution<T> =
  | { status: 'saved'; record: T; origin: CaptureOriginMetadata }
  | { status: 'duplicate'; duplicate: DuplicateMatch; origin: CaptureOriginMetadata }
  | { status: 'discarded'; origin: CaptureOriginMetadata };

export type BatchSaveDecision = 'confirm' | 'save_anyway' | 'discard';
export type BatchSaveResolution =
  | { status: 'saved'; records: Expense[]; matches: BatchDuplicateMatch[]; origins: CaptureOriginMetadata[] }
  | { status: 'needs_review'; matches: BatchDuplicateMatch[]; origins: CaptureOriginMetadata[] }
  | { status: 'discarded'; matches: BatchDuplicateMatch[]; origins: CaptureOriginMetadata[] };

export interface RecurringTemplateHandoff {
  createFromCapture(candidate: CaptureCandidate | IncomeCandidate): Promise<string>;
}

export interface CaptureSideEffectHooks {
  onExpenseSaved(): Promise<void>;
  onIncomeSaved(): Promise<void>;
  // `savedId` is the id of the record the caller just persisted. It is passed so
  // a persisted notification can deep-link to S-08; older callbacks that ignore
  // the second argument remain valid.
  scheduleNotification(candidate: CaptureCandidate | IncomeCandidate, savedId?: string): void;
}

export type AutoCapturePermission = 'unsupported' | 'denied' | 'granted';

export interface AutoCaptureEvent {
  id: string;
  receivedAt: number;
  candidate: CaptureCandidate;
}

export interface AutoCapturePermissionState {
  status: AutoCapturePermission;
  canRequest: boolean;
}

export interface AutoCapturePermissionProvider {
  getState(): Promise<AutoCapturePermissionState>;
  request(): Promise<AutoCapturePermissionState>;
  openSystemSettings(): Promise<void>;
}

export interface AutoCaptureEventSource {
  readonly capability?: AutoCaptureCapability;
  subscribe(listener: (event: AutoCaptureEvent) => void): () => void;
  setLifecycle?(enabled: boolean, permission: AutoCapturePermission): void;
}

export type AutoCaptureCapability = 'available' | 'unavailable' | 'unsupported';
export type AutoCaptureSourceStatus = 'active' | 'not_detected';

export interface AutoCaptureSourceDescriptor {
  id: string;
  packageName: string;
  displayName: string;
  status: AutoCaptureSourceStatus;
}

export interface NativeAutoCaptureNotification {
  id: string;
  packageName: string;
  // Forwarded from the Android notification extras (title plus android.text or
  // bigText). Optional because older native builds send text only; the TS
  // parser treats a missing title as an empty prefix and combines both fields,
  // so Mobile must forward the title once available but text alone still parses.
  title?: string;
  text: string;
  receivedAt: number;
}

export interface NativeAutoCaptureSourceAdapter {
  readonly platform: 'android' | 'ios';
  readonly capability: AutoCaptureCapability;
  getPermissionState(): Promise<AutoCapturePermissionState>;
  getSupportedSources(): Promise<AutoCaptureSourceDescriptor[]>;
  subscribe(listener: (notification: NativeAutoCaptureNotification) => void): () => void;
  setLifecycle?(enabled: boolean, permission: AutoCapturePermission): void;
  openSystemSettings(): Promise<void>;
  // Phase 14 M1 setup guide state for S-22 (M3). Battery exemption is directly
  // detectable via PowerManager; the guard flags report the foreground service.
  // Autostart state has no detection API on Android, so it ships as static
  // brand instructions (AUTOSTART_GUIDE in AutoCaptureSource), never as a sensed
  // value. All three are optional so older native builds without the new async
  // functions keep compiling and fall back honestly.
  getBatteryExemption?(): Promise<BatteryExemptionState>;
  getGuardState?(): Promise<GuardServiceState>;
  openBatterySettings?(): Promise<void>;
  // Phase 14 M2 rich detection alert. Posts the expanded custom notification
  // for one queued draft and cancels it after the draft resolves. The Confirm
  // and Remind later actions land in the native receiver, which records the
  // intent durably; subscribeAlertActions delivers the live copy when the
  // runtime is up and consumePendingAlertAction drains the durable queue one
  // record at a time (null when empty). All three are optional so older
  // native builds and non Android platforms degrade to inbox only.
  showDetectionAlert?(input: DetectionAlertContent): Promise<DetectionAlertPostResult>;
  cancelDetectionAlert?(draftId: string): Promise<void>;
  subscribeAlertActions?(listener: (action: PendingAlertAction) => void): () => void;
  consumePendingAlertAction?(): Promise<PendingAlertAction | null>;
  // Phase 17 background reliability additions. Optional so iOS, web, Expo Go,
  // and older native builds degrade to null / false without crashing.
  consumePendingNativeDetections?(): Promise<PendingNativeDetection | null>;
  openAutostartSettings?(): Promise<boolean>;
}

// One parsed detection persisted natively while the JS runtime was unloaded.
// Carries parsed fields only (never raw notification text).
export interface PendingNativeDetection {
  draftId: string;
  sourceId: string;
  packageName: string;
  appName: string;
  receivedAt: number;
  amount: number;
  currency: string;
  kind: 'expense' | 'income';
  merchant: string;
  sourceName?: string | null;
  confidence?: number | null;
  directionAmbiguous: boolean;
  note: string;
}

// Preformatted alert strings, derived from parsed detection fields only. The
// native builder applies length caps; nothing raw and no key travels here.
export interface DetectionAlertContent {
  draftId: string;
  merchant: string;
  amountText: string;
  sourceLabel: string;
  timeText: string;
}

export interface DetectionAlertPostResult {
  posted: boolean;
}

// One receiver action intent: the draft it targets, the action the user tapped,
// and the epoch millisecond the receiver recorded it.
export interface PendingAlertAction {
  draftId: string;
  action: 'confirm' | 'snooze';
  receivedAt: number;
}

// Directly detectable battery exemption state. Exempt true means the OS skips
// most power saving for this app; exempt false means Doze can pause the
// listener, so the setup guide points at the exemption settings screen.
export interface BatteryExemptionState {
  exempt: boolean;
}

// Foreground guard service state. Running tracks the guard process only and
// connected tracks NotificationListenerService binding state. Never claims
// autostart status, which has no detection API.
export interface GuardServiceState {
  running: boolean;
  connected?: boolean;
  captureEnabled: boolean;
  listenerGranted: boolean;
}

// One brand row of the autostart setup instructions. Steps are static guidance
// written from public OS settings paths, never a sensed on or off state,
// because Android exposes no API that reports autostart manager status.
export interface AutostartGuideEntry {
  brand: string;
  systemPath: string;
  steps: string[];
}

export interface AutoCaptureHostState {
  enabled: boolean;
  permission: AutoCapturePermission;
  listenerAvailable: boolean;
  capability: AutoCaptureCapability;
  supportedSources: AutoCaptureSourceDescriptor[];
  overlayActive: boolean;
  // Total unclaimed detections: the rendered event plus the FIFO queue behind it.
  // Drives the SH-NEW-a "1 of N pending" banner without exposing queue internals.
  pendingCount: number;
}

export interface AutoCaptureHost {
  getState(): AutoCaptureHostState;
  setEnabled(enabled: boolean): void;
  setPermission(permission: AutoCapturePermission): void;
  setCapability(capability: AutoCaptureCapability, sources?: AutoCaptureSourceDescriptor[]): void;
  syncLifecycle(enabled: boolean, permission: AutoCapturePermission, source?: AutoCaptureEventSource, queueEvents?: boolean): void;
  start(source?: AutoCaptureEventSource, queueEvents?: boolean): () => void;
  subscribe(listener: (state: AutoCaptureHostState) => void): () => void;
  claimOverlay(): AutoCaptureEvent | null;
  releaseOverlay(): void;
}

export interface OnboardingSettings {
  profileName?: string;
  currency: string;
  monthlyBudget?: string;
}

export interface AutoCaptureSettings {
  enabled: boolean;
  permission: AutoCapturePermission;
}

export interface OnboardingSettingsStore {
  isOnboardingComplete(): Promise<boolean>;
  completeOnboarding(settings: OnboardingSettings): Promise<void>;
  getAutoCaptureSettings(): Promise<AutoCaptureSettings>;
  updateAutoCaptureSettings(settings: Partial<AutoCaptureSettings>): Promise<AutoCaptureSettings>;
}

export type SpendingRecapOrigin = 'home' | 'insights' | 'profile' | 'notification';

export interface AutoCaptureSettingsRouteContract {
  readonly screen: 'S-22';
}

export interface SpendingRecapRouteContract {
  readonly screen: 'S-23';
  readonly origin: SpendingRecapOrigin;
}

// Boundary for the saved conversion-rate map stored in settings as JSON. The bulk
// conversion pickers need each rate as a preformatted string, so this parses the
// stored shape once. It never invents a rate: unknown or invalid entries are
// dropped and the caller decides what to show. No key or secret is read here.
export type CurrencyRateMap = Record<string, number>;

export function parseCurrencyRateMap(raw: string | null | undefined): CurrencyRateMap {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const rates: CurrencyRateMap = {};
  for (const [code, value] of Object.entries(parsed as Record<string, unknown>)) {
    const numeric = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(numeric) && numeric > 0) rates[code.trim().toUpperCase()] = numeric;
  }
  return rates;
}

// Stable, locale-free formatting for a stored rate so a fixture and a live record
// render the same string. Returns an empty string, never a fabricated value, when
// no valid rate exists.
export function formatConversionRate(rate: number | null | undefined): string {
  return typeof rate === 'number' && Number.isFinite(rate) && rate > 0 ? String(rate) : '';
}
