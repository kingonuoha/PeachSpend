import { describe, expect, it, vi } from 'vitest';

// The scan screen renders native UI and this suite only exercises the barcode
// guard and the provider options it builds, so the native, camera, provider and
// data modules are stubbed. Vitest hoists these above the import, and the two
// pure helpers under test import nothing from them.
vi.mock('react-native', () => ({
  AccessibilityInfo: { isReduceMotionEnabled: vi.fn(async () => false), addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
  Linking: { openSettings: vi.fn() },
  Platform: { OS: 'ios' },
  Pressable: () => null,
  StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
  Text: () => null,
  View: () => null,
}));
vi.mock('react-native-reanimated', () => ({
  default: { View: () => null },
  cancelAnimation: vi.fn(),
  Easing: { inOut: (value: unknown) => value, sin: (value: unknown) => value, ease: (value: unknown) => value },
  useAnimatedStyle: () => ({}),
  useSharedValue: () => ({ value: 0 }),
  withRepeat: (value: unknown) => value,
  withTiming: (value: unknown) => value,
}));
vi.mock('expo-camera', () => ({ CameraView: () => null, useCameraPermissions: () => [null, vi.fn()] }));
vi.mock('expo-blur', () => ({ BlurView: () => null }));
vi.mock('expo-linear-gradient', () => ({ LinearGradient: () => null }));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn(), canGoBack: () => true }) }));
vi.mock('@react-native-community/netinfo', () => ({
  default: { addEventListener: vi.fn(() => vi.fn()), fetch: vi.fn(async () => ({ isConnected: true, isInternetReachable: true })) },
}));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
vi.mock('lucide-react-native', () => ({
  Barcode: () => null,
  Camera: () => null,
  CameraOff: () => null,
  Image: () => null,
  Pencil: () => null,
  X: () => null,
  Zap: () => null,
}));
vi.mock('expo-haptics', () => ({
  selectionAsync: vi.fn(),
  impactAsync: vi.fn(),
  notificationAsync: vi.fn(),
  ImpactFeedbackStyle: { Medium: 'medium' },
  NotificationFeedbackType: { Error: 'error', Success: 'success' },
}));
vi.mock('expo-image-picker', () => ({ launchImageLibraryAsync: vi.fn() }));
// The scan screen's pending-receipt rows render the stored draft image. `expo-image`
// pulls the Expo runtime into the node graph and throws `__DEV__ is not defined` during
// collection, so it is mocked here in the suite's harness prologue, the same way
// receive.test.ts and VerificationSheet.test.ts mock it. Stubbed as a null component so
// the row still renders and every non-image assertion stays live.
vi.mock('expo-image', () => ({ Image: () => null }));
vi.mock('../../services/GeminiService', () => ({ geminiService: { scanReceipt: vi.fn() } }));
vi.mock('../../services/DatabaseService', () => ({ databaseService: { getSecret: vi.fn(), getCaptureRepository: vi.fn(), getCategories: vi.fn() } }));
vi.mock('../../services/NotificationService', () => ({ notificationService: { scheduleExpenseNotification: vi.fn() } }));
vi.mock('../../utils/ownedReceiptImage', () => ({
  copyReceiptImageToAppCache: vi.fn(),
  deleteOwnedReceiptImage: vi.fn(),
  readOwnedReceiptImageAsBase64: vi.fn(),
}));
vi.mock('../../components/capture/AIProcessingOverlay', () => ({ AIProcessingOverlay: () => null }));
vi.mock('../../components/ui/PeachButton', () => ({ PeachButton: () => null }));
vi.mock('../../components/expense/VerificationSheet', () => ({ VerificationSheet: () => null }));
vi.mock('../../components/expense/DuplicateWarningModal', () => ({ DuplicateWarningModal: () => null }));
vi.mock('../../components/ui/SettingsProvider', () => ({ useSettings: () => ({ settings: { currency: 'USD' }, conversionRates: {} }) }));
vi.mock('../../components/ui/ToastProvider', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../../components/ui/AchievementProvider', () => ({ useAchievements: () => ({ checkForNewAchievements: vi.fn() }) }));
vi.mock('../../hooks/useReduceMotion', () => ({ useReduceMotion: () => false }));
vi.mock('../../data', () => ({ resolveExpenseBatchSave: vi.fn(), runCaptureSideEffects: vi.fn(), normalizeCurrencyTotal: vi.fn() }));

// eslint-disable-next-line import/first
import { AI_ERROR_CODES } from '../../ai/contracts';
// eslint-disable-next-line import/first
import type { ScannedReceipt } from '../../types/gemini';
// eslint-disable-next-line import/first
import {
  SCAN_DIALOG_CODES,
  isScanDialogCode,
  processingMode,
  resolveScanFailure,
  scanFailureDialogCopy,
  acceptBarcodeScan,
  productScanOptions,
  reduceBarcode,
  evaluateCaptureGate,
  firstBlockedCaptureMessage,
} from './scan';
// eslint-disable-next-line import/first
import type { BarcodeGate, BarcodeScanEvent, ScanOutcome } from './scan';

const UPC_A = '0123456789012';
const UPC_B = '4006381333931';
const IDLE_PRODUCT = { mode: 'product' as const, isScanning: false, cameraActive: true };

describe('scan screen barcode guard', () => {
  it('never accepts a decoded code in receipt mode', () => {
    expect(acceptBarcodeScan({ ...IDLE_PRODUCT, mode: 'receipt' }, UPC_A)).toBeNull();
  });

  it('accepts a decoded code in product mode and trims it', () => {
    expect(acceptBarcodeScan(IDLE_PRODUCT, `  ${UPC_A}\n`)).toBe(UPC_A);
  });

  it('ignores an empty or whitespace payload', () => {
    expect(acceptBarcodeScan(IDLE_PRODUCT, '   ')).toBeNull();
  });

  it('ignores a read that arrives while a scan is already in flight', () => {
    expect(acceptBarcodeScan({ ...IDLE_PRODUCT, isScanning: true }, UPC_A)).toBeNull();
  });

  it('ignores a read that arrives while the camera is inactive', () => {
    expect(acceptBarcodeScan({ ...IDLE_PRODUCT, cameraActive: false }, UPC_A)).toBeNull();
  });

  it('rejects the code even in product mode when the scan state is not live', () => {
    expect(acceptBarcodeScan({ mode: 'product', isScanning: true, cameraActive: false }, UPC_A)).toBeNull();
  });
});

describe('scan screen barcode plumbing', () => {
  const signal = new AbortController().signal;

  it('sends the decoded code with a product scan', () => {
    const options = productScanOptions('product', UPC_A, signal);
    expect(options.signal).toBe(signal);
    expect(options.barcode).toBe(UPC_A);
  });

  it('never sends a code with a receipt or gallery scan', () => {
    expect(productScanOptions('receipt', UPC_A, signal).barcode).toBeUndefined();
    expect(productScanOptions('gallery', UPC_A, signal).barcode).toBeUndefined();
  });

  it('sends no code when nothing was decoded', () => {
    expect(productScanOptions('product', null, signal).barcode).toBeUndefined();
  });
});

// The decoded code's lifecycle. The screen renders native UI and cannot be rendered here, so these
// pin the pure reducer the screen uses for both the decode event and the scan-end event: a code must
// not survive a scan that ended without a confirmed result, and a repeated event for one code must
// not count as a second scan.
describe('scan decoded-code lifecycle', () => {
  const decode = (data: string, gate: BarcodeGate = IDLE_PRODUCT): BarcodeScanEvent => ({ kind: 'decoded', gate, data });
  const ended = (outcome: ScanOutcome): BarcodeScanEvent => ({ kind: 'ended', outcome });

  it('drops the decoded code when the scan is cancelled', () => {
    expect(reduceBarcode(UPC_A, ended('cancelled'))).toBeNull();
  });

  it('drops the decoded code when the scan fails', () => {
    expect(reduceBarcode(UPC_A, ended('failed'))).toBeNull();
  });

  it('drops the decoded code when the result is abandoned', () => {
    expect(reduceBarcode(UPC_A, ended('abandoned'))).toBeNull();
  });

  it('keeps the decoded code when the result is confirmed, because the code belongs to that result', () => {
    expect(reduceBarcode(UPC_A, ended('confirmed'))).toBe(UPC_A);
  });

  it('lets a later frame decode its own code after a scan that ended without a result', () => {
    // Without the drop, the ended scan's code would be shown against, and sent with, this frame.
    for (const held of [reduceBarcode(UPC_A, ended('cancelled')), reduceBarcode(UPC_A, ended('failed')), reduceBarcode(UPC_A, ended('abandoned'))]) {
      expect(reduceBarcode(held, decode(UPC_B))).toBe(UPC_B);
    }
  });

  it('still accepts a different code within the same scan, so the dedupe is per code and not per scan', () => {
    expect(reduceBarcode(UPC_A, decode(UPC_B))).toBe(UPC_B);
  });

  it('keeps one barcode to one scan, so the drop at the scan end cannot turn a repeated event into a second provider request', () => {
    // The scanner repeats the code on every frame it stays in view, and the provider call runs once
    // per capture and reads the held code. Every repeat must therefore be dropped, so the held code
    // stays the one code the capture sends. The drop at the scan end runs after the frames, never
    // between them, so it cannot reset the dedupe mid scan and produce a second request.
    let held: string | null = null;
    const accepted: string[] = [];
    for (let frame = 0; frame < 6; frame += 1) {
      const next = reduceBarcode(held, decode(UPC_A));
      if (next !== held) accepted.push(next as string);
      held = next;
    }
    expect(accepted).toEqual([UPC_A]);
    expect(productScanOptions('product', held, new AbortController().signal).barcode).toBe(UPC_A);
    expect(reduceBarcode(held, ended('failed'))).toBeNull();
  });
});

// The screen renders native UI, so these exercise the pure copy selection rather than the rendered
// dialog. They prove the real mode reaches the copy, that the two modes never share nouns, that no
// sentence asserts a photographic cause the app never establishes, and that a response the app could
// not use is titled by its own class rather than as a read failure.
describe('scan failure mode resolution', () => {
  it('maps each processing context to the mode the pipeline actually ran in', () => {
    expect(processingMode('receipt')).toBe('receipt');
    expect(processingMode('gallery')).toBe('receipt');
    expect(processingMode('product')).toBe('product');
  });

  it('passes the mode through to the copy for both modes', () => {
    for (const code of SCAN_DIALOG_CODES) {
      const receipt = resolveScanFailure(code, 'receipt');
      const product = resolveScanFailure(code, 'product');
      expect(receipt.kind).toBe('dialog');
      expect(product.kind).toBe('dialog');
      if (receipt.kind !== 'dialog' || product.kind !== 'dialog') continue;
      // Different copy in the two modes can only happen if the mode reached getAiErrorMessage.
      expect(receipt.title).not.toBe(product.title);
      expect(receipt.body).not.toBe(product.body);
    }
  });

  it('names each mode with its own noun and never the other mode', () => {
    for (const code of SCAN_DIALOG_CODES) {
      const receipt = scanFailureDialogCopy(code, 'receipt');
      const product = scanFailureDialogCopy(code, 'product');
      const receiptText = `${receipt.title} ${receipt.body}`.toLowerCase();
      const productText = `${product.title} ${product.body}`.toLowerCase();
      expect(receiptText).toContain('receipt');
      expect(receiptText).not.toContain('product');
      expect(productText).toContain('product');
      expect(productText).not.toContain('receipt');
    }
  });

  it('never asserts blur, dim or lighting, because the app never establishes any of them', () => {
    for (const mode of ['receipt', 'product'] as const) {
      for (const code of SCAN_DIALOG_CODES) {
        const { title, body } = scanFailureDialogCopy(code, mode);
        for (const sentence of [title, body]) {
          expect(sentence).not.toContain('blur');
          expect(sentence).not.toContain('dim');
          expect(sentence).not.toContain('lighting');
        }
      }
    }
  });

  it('names the response class in the titles for a response the app could not use', () => {
    expect(scanFailureDialogCopy('invalid_response', 'receipt').title).toBe('Receipt Response Unusable');
    expect(scanFailureDialogCopy('invalid_response', 'product').title).toBe('Product Response Unusable');
  });

  it('keeps the two dialog codes distinguishable and never names the reading class for an unusable response', () => {
    for (const mode of ['receipt', 'product'] as const) {
      const responseTitle = scanFailureDialogCopy('invalid_response', mode).title;
      // The reading class belongs to `illegible_image`, the case where the photograph really was the
      // problem, so the two codes must not end up with one shared title.
      expect(responseTitle).not.toBe(scanFailureDialogCopy('illegible_image', mode).title);
      const words = responseTitle.toLowerCase();
      for (const readingClass of ['read', 'unclear', 'blur', 'dim', 'lighting']) {
        expect(words).not.toContain(readingClass);
      }
    }
  });
});

describe('scan failure surface routing', () => {
  it('routes the two unusable-scan codes to the dialog and every other code to a visible toast', () => {
    for (const code of AI_ERROR_CODES) {
      const surface = resolveScanFailure(code, 'receipt');
      if (isScanDialogCode(code)) {
        expect(surface.kind).toBe('dialog');
      } else {
        expect(surface.kind).toBe('toast');
      }
    }
  });

  it('keeps offline, missing key and provider failures specific rather than silent', () => {
    expect(resolveScanFailure('offline', 'product')).toEqual({ kind: 'toast', message: 'AI provider is unavailable offline.' });
    expect(resolveScanFailure('missing_key', 'product')).toEqual({ kind: 'toast', message: 'AI provider key is not configured.' });
    expect(resolveScanFailure('provider', 'receipt')).toEqual({ kind: 'toast', message: 'AI provider request failed. Try again.' });
  });
});

// The gate is the last check before a capture reaches the save boundary, so these
// exercise its decision and its copy rather than the rendered toast. The rules
// are pinned against the boundary read at data/contracts.ts:83, whose merchant
// requirement is source based and whose scanned source is 'ocr', which this
// screen always builds.
describe('scan pre-save gate', () => {
  const item = (patch: Partial<ScannedReceipt> = {}): ScannedReceipt => ({
    merchant: 'Corner Store',
    amount: 12.5,
    currency: 'USD',
    category: 'groceries',
    ...patch,
  });

  it('lets a product with no merchant and a price through, because the boundary accepts an empty merchant for a scanned product', () => {
    expect(evaluateCaptureGate(item({ merchant: '' }), 'product')).toEqual({ canSave: true });
  });

  it('refuses a product with no price and names the price rather than receipt fields', () => {
    const decision = evaluateCaptureGate(item({ merchant: '', amount: 0 }), 'product');
    expect(decision.canSave).toBe(false);
    if (decision.canSave) return;
    expect(decision.message).toBe('Add a price before saving this product.');
  });

  it('lets a receipt with a store name through', () => {
    expect(evaluateCaptureGate(item(), 'receipt')).toEqual({ canSave: true });
  });

  it('refuses a receipt with no store name, keeping the rule receipt mode always had', () => {
    const decision = evaluateCaptureGate(item({ merchant: '   ' }), 'receipt');
    expect(decision.canSave).toBe(false);
    if (decision.canSave) return;
    expect(decision.message).toBe('Add the store name before saving this receipt.');
  });

  it('refuses a product missing a category and names the category', () => {
    const decision = evaluateCaptureGate(item({ merchant: '', category: '' }), 'product');
    expect(decision.canSave).toBe(false);
    if (decision.canSave) return;
    expect(decision.message).toBe('Add a category before saving this product.');
  });

  it('refuses a missing currency in both modes, matching the boundary', () => {
    expect(evaluateCaptureGate(item({ currency: '  ' }), 'receipt').canSave).toBe(false);
    expect(evaluateCaptureGate(item({ merchant: '', currency: '' }), 'product').canSave).toBe(false);
  });

  it('refuses a non finite or non positive amount in both modes, as the boundary does', () => {
    for (const mode of ['receipt', 'product'] as const) {
      expect(evaluateCaptureGate(item({ amount: 0 }), mode).canSave).toBe(false);
      expect(evaluateCaptureGate(item({ amount: -3 }), mode).canSave).toBe(false);
      expect(evaluateCaptureGate(item({ amount: Number.NaN }), mode).canSave).toBe(false);
    }
  });

  it('never names a merchant or a receipt in any product message', () => {
    const productFailures = [
      item({ merchant: '', amount: 0 }),
      item({ merchant: '', amount: Number.NaN }),
      item({ merchant: '', currency: '' }),
      item({ merchant: '', category: '   ' }),
    ];
    for (const failing of productFailures) {
      const decision = evaluateCaptureGate(failing, 'product');
      expect(decision.canSave).toBe(false);
      if (decision.canSave) continue;
      const text = decision.message.toLowerCase();
      expect(text).not.toContain('merchant');
      expect(text).not.toContain('receipt');
    }
  });

  it('names each mode with its own noun in the gate copy too', () => {
    const receiptBlocked = evaluateCaptureGate(item({ merchant: '' }), 'receipt');
    const productBlocked = evaluateCaptureGate(item({ merchant: '', amount: 0 }), 'product');
    expect(receiptBlocked.canSave).toBe(false);
    expect(productBlocked.canSave).toBe(false);
    if (receiptBlocked.canSave || productBlocked.canSave) return;
    expect(receiptBlocked.message.toLowerCase()).toContain('receipt');
    expect(productBlocked.message.toLowerCase()).toContain('product');
  });

  it('reports the first refused item in a batch and passes a clean batch', () => {
    expect(firstBlockedCaptureMessage([item({ merchant: '' }), item({ merchant: '', amount: 0 })], 'product'))
      .toBe('Add a price before saving this product.');
    expect(firstBlockedCaptureMessage([item(), item({ amount: 5 })], 'receipt')).toBeNull();
    expect(firstBlockedCaptureMessage([item({ merchant: '' }), item({ merchant: '', amount: 4 })], 'product')).toBeNull();
    expect(firstBlockedCaptureMessage([item({ merchant: '' })], 'receipt'))
      .toBe('Add the store name before saving this receipt.');
    expect(firstBlockedCaptureMessage([], 'product')).toBeNull();
  });
});
