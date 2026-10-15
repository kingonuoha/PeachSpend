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
import { acceptBarcodeScan, productScanOptions } from './scan';

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
