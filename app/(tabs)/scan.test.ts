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
  evaluateCaptureGate,
  firstBlockedCaptureMessage,
} from './scan';

const UPC_A = '0123456789012';
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

// The screen renders native UI, so these exercise the pure copy selection rather than the rendered
// dialog. They prove the real mode reaches the copy, that the two modes never share nouns, and that
// no sentence asserts a photographic cause the app never establishes.
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
