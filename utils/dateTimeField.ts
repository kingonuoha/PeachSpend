// Transition table for the Log Expense date and time control.
//
// It lives outside `app/expense/manual.tsx` for two reasons. That file is an Expo
// Router route, so vitest cannot import it without stubbing expo-sqlite, the
// native picker and half the component tree; `utils/` is where this repo's pure,
// tested helpers already live (`currency.ts`). And the two decisions that were
// wrong on iOS, when the picker closes and when the mode advances, were both
// buried inside an inline `onChange` handler, so no test could reach them.
//
// The screen owns the value (`enteredDate`); this module only decides whether the
// control is open and which half of the value it is editing.

export type DateTimeFieldPlatform = 'ios' | 'android';
export type DateTimeFieldMode = 'date' | 'time';

// Real events, not hypothetical ones: `open` is the Date and Time card press,
// `set` is the picker's own value event, `dismissed` is the system cancel,
// `switchMode` is the Date and Time chips, `done` is the explicit close the iOS
// spinner needs because it has no dismissal of its own.
export type DateTimeFieldAction = 'open' | 'set' | 'dismissed' | 'switchMode' | 'done';

export interface DateTimeFieldState {
  visible: boolean;
  mode: DateTimeFieldMode;
}

export const CLOSED_DATE_TIME_FIELD: DateTimeFieldState = { visible: false, mode: 'date' };

export function nextDateTimeFieldState(
  platform: DateTimeFieldPlatform,
  current: DateTimeFieldState,
  action: DateTimeFieldAction,
): DateTimeFieldState {
  switch (action) {
    case 'open':
      // Always starts on the date half, so a second visit never opens on the clock.
      return { visible: true, mode: 'date' };

    case 'set':
      // iOS renders the wheels inline and reports every scroll, so a selection is
      // an edit in progress, not the end of it. Android presents a modal dialog
      // that closes on every pick, so the date step hands off to the time step and
      // the time step ends the flow. Resetting to 'date' here is also what stops
      // the next Android open from landing on the clock (F-08).
      if (platform === 'ios') return current;
      return current.mode === 'date'
        ? { visible: true, mode: 'time' }
        : { visible: false, mode: 'date' };

    case 'switchMode':
      return { visible: true, mode: current.mode === 'date' ? 'time' : 'date' };

    case 'dismissed':
    case 'done':
      return { visible: false, mode: 'date' };
  }
}
