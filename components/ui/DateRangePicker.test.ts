import { describe, expect, it, vi } from 'vitest';

// The picker renders native UI, so this suite exercises the pure bounds helper the
// commit action resolves through rather than the rendered sheet. Vitest hoists these
// mocks above the import, and the helper under test imports nothing from the stubbed
// modules.
vi.mock('react-native', () => ({
  AccessibilityInfo: {
    announceForAccessibility: vi.fn(),
    sendAccessibilityEvent: vi.fn(),
    isReduceMotionEnabled: async () => false,
    addEventListener: () => ({ remove: () => undefined }),
  },
  Modal: () => null,
  Pressable: () => null,
  Text: () => null,
  TouchableOpacity: () => null,
  useWindowDimensions: () => ({ width: 390, height: 844 }),
  View: () => null,
}));
vi.mock('lucide-react-native', () => ({ ChevronLeft: () => null, ChevronRight: () => null }));
vi.mock('expo-haptics', () => ({
  selectionAsync: vi.fn(),
  impactAsync: vi.fn(),
  notificationAsync: vi.fn(),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Error: 'error' },
}));
vi.mock('../../hooks/useThemeStyles', () => ({ useThemeStyles: () => ({}) }));
vi.mock('../../hooks/useReduceMotion', () => ({ useReduceMotion: () => false }));

// eslint-disable-next-line import/first
import { eachDayOfInterval } from 'date-fns';
// eslint-disable-next-line import/first
import { customRangeBounds } from './DateRangePicker';

interface Period { start: number; end: number }

// The comparison every consumer of this component already makes against a resolved
// period, copied unchanged from `app/(tabs)/analytics.tsx:138` and
// `data/InsightDataService.ts:123`. The defect was invisible to the suite because
// nothing pinned what the picker's two Dates mean to that comparison.
function isInsidePeriod(date: number, period: Period): boolean {
  return date >= period.start && date <= period.end;
}

function asPeriod(bounds: { start: Date; end: Date }): Period {
  return { start: bounds.start.getTime(), end: bounds.end.getTime() };
}

function at(year: number, monthIndex: number, day: number, hours = 0, minutes = 0, seconds = 0, ms = 0): Date {
  return new Date(year, monthIndex, day, hours, minutes, seconds, ms);
}

describe('DateRangePicker custom range bounds (DEC-B110)', () => {
  it('covers the whole of a one day range, so the day it names returns its records', () => {
    const day = at(2026, 2, 14);
    const bounds = asPeriod(customRangeBounds(day, day));

    expect(isInsidePeriod(at(2026, 2, 14, 0, 0, 0, 0).getTime(), bounds)).toBe(true);
    expect(isInsidePeriod(at(2026, 2, 14, 9, 30).getTime(), bounds)).toBe(true);
    expect(isInsidePeriod(at(2026, 2, 14, 23, 59, 59, 999).getTime(), bounds)).toBe(true);
    expect(isInsidePeriod(at(2026, 2, 15).getTime(), bounds)).toBe(false);
  });

  it('includes the last day of a multi-day range, where the raw day cell dropped it', () => {
    const bounds = asPeriod(customRangeBounds(at(2026, 2, 1), at(2026, 2, 3)));

    expect(isInsidePeriod(at(2026, 2, 3, 12, 15).getTime(), bounds)).toBe(true);
    expect(isInsidePeriod(at(2026, 2, 4, 0, 0, 0, 0).getTime(), bounds)).toBe(false);
    expect(isInsidePeriod(at(2026, 1, 28, 23, 59).getTime(), bounds)).toBe(false);
  });

  it('keeps both named day boundaries inclusive at the exact boundary instant', () => {
    const bounds = asPeriod(customRangeBounds(at(2026, 2, 1), at(2026, 2, 3)));

    expect(bounds.start).toEqual(at(2026, 2, 1, 0, 0, 0, 0).getTime());
    expect(bounds.end).toEqual(at(2026, 2, 3, 23, 59, 59, 999).getTime());
    expect(isInsidePeriod(bounds.start, bounds)).toBe(true);
    expect(isInsidePeriod(bounds.end, bounds)).toBe(true);
    expect(isInsidePeriod(bounds.end + 1, bounds)).toBe(false);
  });

  it('normalises the seeded prefill, which carries a time of day rather than midnight', () => {
    const opened = at(2026, 2, 14, 14, 37, 12, 345);
    const bounds = asPeriod(customRangeBounds(opened, opened));

    expect(bounds.start).toEqual(at(2026, 2, 14, 0, 0, 0, 0).getTime());
    expect(bounds.end).toEqual(at(2026, 2, 14, 23, 59, 59, 999).getTime());
    expect(isInsidePeriod(at(2026, 2, 14, 8).getTime(), bounds)).toBe(true);
  });

  it('fixes the midnight day cells the month grid actually hands over', () => {
    const cells = eachDayOfInterval({ start: at(2026, 2, 1), end: at(2026, 2, 3) });
    // The grid draws local midnight day cells; passing one straight through was the
    // defect, so this is the assertion a revert of the normalisation fails.
    expect(cells.map(cell => cell.getHours())).toEqual([0, 0, 0]);

    const lastDayRecord = at(2026, 2, 3, 12).getTime();
    const raw: Period = { start: cells[0].getTime(), end: cells[cells.length - 1].getTime() };
    expect(isInsidePeriod(lastDayRecord, raw)).toBe(false);
    expect(isInsidePeriod(lastDayRecord, asPeriod(customRangeBounds(cells[0], cells[cells.length - 1])))).toBe(true);
  });
});
