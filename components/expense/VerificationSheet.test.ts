import { describe, expect, it, vi } from 'vitest';
import { resolveConfirmItems, resolveVerificationGate, type VerificationGateInput } from './VerificationSheet';
import type { ScannedReceipt } from '../../types/gemini';

// VerificationSheet renders native UI, and this suite exercises only the confirm
// gate and the merchant it records, so the native and screen level modules are
// stubbed. Vitest hoists these above the import, and the pure helpers under test
// import nothing from them.
vi.mock('react-native', () => ({
  KeyboardAvoidingView: () => null,
  Modal: () => null,
  Platform: { OS: 'ios' },
  Pressable: () => null,
  ScrollView: () => null,
  StyleSheet: { absoluteFill: {} },
  Text: () => null,
  TextInput: () => null,
  TouchableOpacity: () => null,
  useWindowDimensions: () => ({ width: 390, height: 844 }),
  View: () => null,
}));
vi.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: () => null },
  useReducedMotion: () => false,
}));
vi.mock('react-native-gesture-handler', () => ({ GestureDetector: () => null }));
vi.mock('expo-image', () => ({ Image: () => null }));
vi.mock('lucide-react-native', () => ({
  AlertCircle: () => null,
  AlertTriangle: () => null,
  ChevronRight: () => null,
  RotateCcw: () => null,
  Trash2: () => null,
}));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
vi.mock('../capture/CategoryGlyph', () => ({ CategoryGlyph: () => null }));
vi.mock('../capture/CategoryPickerSheet', () => ({ CategoryPickerSheet: () => null }));
vi.mock('../ui/PeachButton', () => ({ PeachButton: () => null }));
vi.mock('../../hooks/useThemeStyles', () => ({ useThemeStyles: () => ({}) }));
vi.mock('../../hooks/useSheetDragToDismiss', () => ({
  useSheetDragToDismiss: () => ({ pan: {}, sheetStyle: {}, backdropStyle: {} }),
}));
vi.mock('../../services/DatabaseService', () => ({
  databaseService: { getCategories: vi.fn() },
}));

// A complete, confirmable candidate. Each case below changes only the fields the
// case is about, so the gate is the only variable under test.
const baseGate: VerificationGateInput = {
  merchant: 'Whole Foods Market',
  total: 64.2,
  categoryId: 'dining',
  itemCount: 1,
  saving: false,
};

describe('verification confirm gate (BUG-09-14)', () => {
  it('confirms a scanned product that has no merchant', () => {
    // Scan and share callers pass no source, which is the scanned behaviour.
    const unset = resolveVerificationGate({ ...baseGate, merchant: '' });
    expect(unset.merchantRequired).toBe(false);
    expect(unset.merchantError).toBe(false);
    expect(unset.canConfirm).toBe(true);

    // The scan screen's product candidates carry source 'ocr'.
    const product = resolveVerificationGate({ ...baseGate, merchant: '', source: 'ocr' });
    expect(product.merchantError).toBe(false);
    expect(product.canConfirm).toBe(true);
  });

  it('still blocks a manual entry that has not been filled in yet', () => {
    const gate = resolveVerificationGate({ ...baseGate, merchant: '', source: 'manual' });
    expect(gate.merchantRequired).toBe(true);
    expect(gate.merchantError).toBe(true);
    expect(gate.canConfirm).toBe(false);
  });

  it('leaves a receipt with a merchant unaffected', () => {
    expect(resolveVerificationGate({ ...baseGate, merchant: 'Cafe' })).toEqual({
      merchantRequired: false,
      merchantError: false,
      amountError: false,
      categoryError: false,
      canConfirm: true,
    });
  });

  it('keeps every non-merchant gate exactly as it was', () => {
    expect(resolveVerificationGate({ ...baseGate, total: 0 }).canConfirm).toBe(false);
    expect(resolveVerificationGate({ ...baseGate, total: -5 }).canConfirm).toBe(false);
    expect(resolveVerificationGate({ ...baseGate, categoryId: '  ' }).canConfirm).toBe(false);
    expect(resolveVerificationGate({ ...baseGate, itemCount: 0 }).canConfirm).toBe(false);
    expect(resolveVerificationGate({ ...baseGate, saving: true }).canConfirm).toBe(false);
  });

  it('records an absent merchant, not a placeholder string', () => {
    const product = { merchant: '', amount: 3.5, category: 'dining', currency: 'USD', note: 'Milk' };
    const [recorded] = resolveConfirmItems([product]);
    expect(recorded.merchant).toBe('');
    expect(recorded.merchant).not.toBe('Unknown');
    expect(recorded.note).toBe('Milk');

    // A real merchant is passed through unchanged.
    expect(resolveConfirmItems([{ ...product, merchant: 'Cafe' }])[0].merchant).toBe('Cafe');

    // The data prop is `unknown`, so a malformed candidate can reach here. An
    // absent merchant still records as empty rather than as a fabricated value.
    const malformed = [{ ...product, merchant: undefined }] as unknown as ScannedReceipt[];
    expect(resolveConfirmItems(malformed)[0].merchant).toBe('');
  });
});
