import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

import {
  CLOSED_DATE_TIME_FIELD,
  nextDateTimeFieldState,
  type DateTimeFieldAction,
  type DateTimeFieldMode,
  type DateTimeFieldPlatform,
  type DateTimeFieldState,
} from '../../utils/dateTimeField';

// Phase 11 B2-2 and B2-3. One date and time control for both entry screens.
//
// The decisions (when the control is open, which half is being edited) live in
// `utils/dateTimeField.ts`, which is already pure and tested. This hook owns the value
// and the Android hand-off, so the expense and income forms cannot drift apart on
// either. It is component-adjacent rather than in `hooks/` because only these two
// capture screens use it and this batch owns `components/capture/`.

// Android presents a modal dialog that closes on every pick, so the date step hands
// off to the time step. The dismissal has to settle before the second dialog presents,
// otherwise the second one opens behind the first.
const DATE_TIME_HANDOFF_MS = 100;

export function useDateTimeFieldControl(initialDate?: Date) {
  const platform: DateTimeFieldPlatform = Platform.OS === 'ios' ? 'ios' : 'android';
  const [value, setValue] = useState<Date>(() => initialDate ?? new Date());
  const [field, setField] = useState<DateTimeFieldState>(CLOSED_DATE_TIME_FIELD);
  const handoffTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A queued Android hand-off must not fire into an unmounted screen.
  useEffect(() => () => {
    if (handoffTimer.current !== null) clearTimeout(handoffTimer.current);
  }, []);

  const apply = useCallback((action: DateTimeFieldAction) => {
    setField(current => nextDateTimeFieldState(platform, current, action));
  }, [platform]);

  const handleChange = useCallback((_event: unknown, next: Date) => {
    setValue(next);
    const state = nextDateTimeFieldState(platform, field, 'set');
    if (platform === 'android' && state.visible && state.mode !== field.mode) {
      // One commit closes the date dialog, the next presents the clock.
      setField({ visible: false, mode: field.mode });
      handoffTimer.current = setTimeout(() => {
        handoffTimer.current = null;
        setField(state);
      }, DATE_TIME_HANDOFF_MS);
      return;
    }
    setField(state);
  }, [field, platform]);

  const open = useCallback(() => apply('open'), [apply]);
  const dismiss = useCallback(() => apply('dismissed'), [apply]);
  const done = useCallback(() => apply('done'), [apply]);

  const switchMode = useCallback((mode: DateTimeFieldMode) => {
    if (mode === field.mode) return;
    void Haptics.selectionAsync();
    apply('switchMode');
  }, [apply, field.mode]);

  return { platform, value, field, open, dismiss, done, switchMode, handleChange };
}
