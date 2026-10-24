import { describe, expect, it, vi } from 'vitest';

// The share screen renders native UI, so this suite exercises the pure recovery and
// outcome helpers rather than the rendered card. Vitest hoists these mocks above the
// import, and the helpers under test import nothing from the stubbed modules.
vi.mock('react-native', () => ({
  // ScalePressable calls Animated.createAnimatedComponent at module scope, and the
  // screen speaks through AccessibilityInfo, so both are present even though this suite
  // does not render the UI.
  AccessibilityInfo: {
    announceForAccessibility: vi.fn(),
    isReduceMotionEnabled: async () => false,
    addEventListener: () => ({ remove: () => undefined }),
  },
  Animated: {
    Value: class {
      setValue = vi.fn();
      interpolate = vi.fn(() => '');
    },
    timing: vi.fn(() => ({ start: vi.fn() })),
    createAnimatedComponent: (component: unknown) => component,
  },
  Easing: { inOut: () => () => 0, ease: () => 0 },
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
import { RECOVERY_MANUAL_ROUTE, describeRecoveryAnnouncement, describeSavedBatch, recoveryKind, resolveRecoveryPresentation } from './receive';

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

describe('share async outcome announcements, spoken text matches rendered text', () => {
  it('announces the same heading the card renders, plus the message, for a response the app could not use', () => {
    const message = getAiErrorMessage('invalid_response', 'receipt');
    const spoken = describeRecoveryAnnouncement('invalid_response', message);
    expect(spoken).toBe(`${resolveRecoveryPresentation('invalid_response').heading}. ${message}`);
    expect(spoken).toContain('response');
    expect(spoken).not.toContain('image');
  });

  it('announces the image heading for every code that keeps it, and for the consumed token', () => {
    for (const code of AI_ERROR_CODES) {
      if (code === 'invalid_response' || code === 'cancelled') continue;
      const spoken = describeRecoveryAnnouncement(code, getAiErrorMessage(code, 'receipt'));
      expect(spoken.startsWith("Couldn't Read Shared Image. ")).toBe(true);
    }
    expect(describeRecoveryAnnouncement(null, 'This shared image is no longer available. Share it again to retry.'))
      .toBe("Couldn't Read Shared Image. This shared image is no longer available. Share it again to retry.");
  });

  it('uses one success sentence for the render and for the announcement', () => {
    const single = describeSavedBatch([
      { merchant: 'Whole Foods Market', amount: 18.2, currency: 'USD', category: 'groceries' },
    ]);
    expect(single.merchant).toBe('Whole Foods Market ($18.20)');
    expect(single.tail).toBe(' has been logged under Groceries.');

    const multi = describeSavedBatch([
      { merchant: 'A', amount: 1, currency: 'USD', category: 'groceries' },
      { merchant: 'B', amount: 2, currency: 'USD', category: 'dining' },
    ]);
    expect(multi.merchant).toBeNull();
    expect(multi.tail).toBe('2 shared receipts have been logged to your ledger.');
  });

  it('keeps the empty-batch sentence honest rather than claiming a save', () => {
    expect(describeSavedBatch([])).toEqual({
      merchant: null,
      tail: '0 shared receipts have been logged to your ledger.',
    });
  });
});
