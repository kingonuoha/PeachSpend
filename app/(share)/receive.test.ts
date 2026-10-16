import { describe, expect, it, vi } from 'vitest';

// The share screen renders native UI, so this suite exercises the pure recovery
// presentation rather than the rendered card. Vitest hoists these mocks above the
// import, and the helpers under test import nothing from the stubbed modules.
vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  Pressable: () => null,
  ScrollView: () => null,
  StyleSheet: { create: (styles: unknown) => styles },
  Text: () => null,
  View: () => null,
}));
vi.mock('expo-image', () => ({ Image: () => null }));
vi.mock('expo-image-picker', () => ({ launchImageLibraryAsync: vi.fn() }));
vi.mock('expo-router', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn(), canGoBack: () => true }),
  useLocalSearchParams: () => ({}),
  useFocusEffect: vi.fn(),
}));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
vi.mock('lucide-react-native', () => ({
  Check: () => null,
  Home: () => null,
  Image: () => null,
  Pencil: () => null,
  Share2: () => null,
  ShieldCheck: () => null,
  TriangleAlert: () => null,
  X: () => null,
}));
vi.mock('expo-haptics', () => ({
  impactAsync: vi.fn(),
  notificationAsync: vi.fn(),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Error: 'error', Success: 'success' },
}));
vi.mock('@react-native-community/netinfo', () => ({
  default: { fetch: vi.fn(async () => ({ isConnected: true, isInternetReachable: true })) },
}));
vi.mock('../../hooks/useThemeStyles', () => ({ useThemeStyles: () => ({ isDark: false }) }));
vi.mock('../../components/ui/PeachButton', () => ({ PeachButton: () => null }));
vi.mock('../../components/capture/AIProcessingOverlay', () => ({ AIProcessingOverlay: () => null }));
vi.mock('../../components/expense/VerificationSheet', () => ({ VerificationSheet: () => null }));
vi.mock('../../components/expense/DuplicateWarningModal', () => ({ DuplicateWarningModal: () => null }));
vi.mock('../../components/ui/SettingsProvider', () => ({ useSettings: () => ({ settings: { currency: 'USD' }, conversionRates: {} }) }));
vi.mock('../../components/ui/ToastProvider', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../../components/ui/AchievementProvider', () => ({ useAchievements: () => ({ checkForNewAchievements: vi.fn() }) }));
vi.mock('../../services/GeminiService', () => ({ geminiService: { scanReceipt: vi.fn() } }));
vi.mock('../../services/DatabaseService', () => ({ databaseService: { getSecret: vi.fn(), getCaptureRepository: vi.fn() } }));
vi.mock('../../services/NotificationService', () => ({ notificationService: { scheduleExpenseNotification: vi.fn() } }));
vi.mock('../../utils/ownedReceiptImage', () => ({
  cleanupOwnedImage: vi.fn(),
  copyReceiptImageToAppCache: vi.fn(),
  readOwnedReceiptImageAsBase64: vi.fn(),
}));
vi.mock('../../utils/shareIntentHandoff', () => ({ consumeShareIntentHandoff: vi.fn() }));
vi.mock('../../data', () => ({ resolveExpenseBatchSave: vi.fn(), runCaptureSideEffects: vi.fn(), normalizeCurrencyTotal: vi.fn() }));

// eslint-disable-next-line import/first
import { AI_ERROR_CODES, getAiErrorMessage } from '../../ai/contracts';
// eslint-disable-next-line import/first
import { RECOVERY_MANUAL_ROUTE, recoveryKind, resolveRecoveryPresentation } from './receive';

// The words that assert a photographic cause. The app only establishes one for
// `illegible_image`, so no other code may be answered with them.
const PHOTOGRAPHIC_WORDS = ['glare', 'lighting', 'blur', 'dim', 'legible'];

describe('share recovery presentation, one cause per failure code', () => {
  it('shows no photographic advice and names the response for a response the app could not use', () => {
    const view = resolveRecoveryPresentation('invalid_response');
    expect(view.advice).toEqual([]);
    const copy = `${view.heading} ${getAiErrorMessage('invalid_response', 'receipt')}`.toLowerCase();
    for (const word of PHOTOGRAPHIC_WORDS) expect(copy).not.toContain(word);
  });

  it('keeps the heading and the body in the same cause class for the response case', () => {
    const heading = resolveRecoveryPresentation('invalid_response').heading.toLowerCase();
    const body = getAiErrorMessage('invalid_response', 'receipt').toLowerCase();
    expect(heading).toContain('response');
    expect(body).toContain('response');
    expect(heading).not.toContain('image');
  });

  it('offers the manual route for a response the app could not use, on the route the scan surface uses', () => {
    expect(resolveRecoveryPresentation('invalid_response').manualEntry).toBe(true);
    expect(RECOVERY_MANUAL_ROUTE).toBe('/expense/manual');
  });

  it('still offers its photographic advice for an image the provider could not read', () => {
    const view = resolveRecoveryPresentation('illegible_image');
    expect(view.advice.length).toBeGreaterThan(0);
    const advice = view.advice.join(' ').toLowerCase();
    expect(advice).toContain('glare');
    expect(advice).toContain('legible');
    expect(view.manualEntry).toBe(true);
  });

  it('keeps the photographic advice off every code that is not an unreadable image', () => {
    for (const code of AI_ERROR_CODES) {
      if (code === 'illegible_image') continue;
      expect(resolveRecoveryPresentation(code).advice).toEqual([]);
    }
    // The consumed handoff token is not a photographic failure either.
    expect(resolveRecoveryPresentation(null).advice).toEqual([]);
  });

  it('keeps offline and missing key copy unchanged, with no advice card', () => {
    expect(getAiErrorMessage('offline', 'receipt')).toBe('AI provider is unavailable offline.');
    expect(getAiErrorMessage('missing_key', 'receipt')).toBe('AI provider key is not configured.');

    const offline = resolveRecoveryPresentation('offline');
    expect(offline.heading).toBe("Couldn't Read Shared Image");
    expect(offline.advice).toEqual([]);
    // Offline already routes to manual entry as its primary action, so it adds none.
    expect(offline.manualEntry).toBe(false);

    const missingKey = resolveRecoveryPresentation('missing_key');
    expect(missingKey.heading).toBe("Couldn't Read Shared Image");
    expect(missingKey.advice).toEqual([]);
    // Missing key keeps its provider settings action, so it adds no manual route.
    expect(missingKey.manualEntry).toBe(false);
  });

  it('derives the kind from the code for every code, so the primary action cannot drift', () => {
    for (const code of AI_ERROR_CODES) {
      const expected = code === 'offline' ? 'offline' : code === 'missing_key' ? 'missing_key' : 'generic';
      expect(recoveryKind(code)).toBe(expected);
    }
    expect(recoveryKind(null)).toBe('generic');
  });

  it('adds the manual route to every card whose primary action is not already it', () => {
    expect(resolveRecoveryPresentation('provider').manualEntry).toBe(true);
    expect(resolveRecoveryPresentation('rate_limited').manualEntry).toBe(true);
    expect(resolveRecoveryPresentation('unauthorized').manualEntry).toBe(true);
    expect(resolveRecoveryPresentation('timeout').manualEntry).toBe(true);
    expect(resolveRecoveryPresentation(null).manualEntry).toBe(true);
  });
});
