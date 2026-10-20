import { describe, expect, it } from 'vitest';
import {
  CLOSED_DATE_TIME_FIELD,
  nextDateTimeFieldState,
  type DateTimeFieldPlatform,
  type DateTimeFieldState,
} from './dateTimeField';

const OPEN_DATE: DateTimeFieldState = { visible: true, mode: 'date' };
const OPEN_TIME: DateTimeFieldState = { visible: true, mode: 'time' };

describe('nextDateTimeFieldState, Android', () => {
  const platform: DateTimeFieldPlatform = 'android';

  it('opens on the date half', () => {
    expect(nextDateTimeFieldState(platform, CLOSED_DATE_TIME_FIELD, 'open')).toEqual(OPEN_DATE);
  });

  it('advances from date to time after a date is picked', () => {
    expect(nextDateTimeFieldState(platform, OPEN_DATE, 'set')).toEqual(OPEN_TIME);
  });

  it('closes after the time is picked, and leaves the next open on the date half', () => {
    expect(nextDateTimeFieldState(platform, OPEN_TIME, 'set')).toEqual(CLOSED_DATE_TIME_FIELD);
  });

  it('closes on a dismissal without advancing to the time half', () => {
    expect(nextDateTimeFieldState(platform, OPEN_DATE, 'dismissed')).toEqual(CLOSED_DATE_TIME_FIELD);
    expect(nextDateTimeFieldState(platform, OPEN_TIME, 'dismissed')).toEqual(CLOSED_DATE_TIME_FIELD);
  });

  it('flips the mode from the chips', () => {
    expect(nextDateTimeFieldState(platform, OPEN_DATE, 'switchMode')).toEqual(OPEN_TIME);
    expect(nextDateTimeFieldState(platform, OPEN_TIME, 'switchMode')).toEqual(OPEN_DATE);
  });

  it('walks the whole sequence date pick, time pick, closed', () => {
    const afterOpen = nextDateTimeFieldState(platform, CLOSED_DATE_TIME_FIELD, 'open');
    const afterDate = nextDateTimeFieldState(platform, afterOpen, 'set');
    const afterTime = nextDateTimeFieldState(platform, afterDate, 'set');
    expect(afterOpen).toEqual(OPEN_DATE);
    expect(afterDate).toEqual(OPEN_TIME);
    expect(afterTime.visible).toBe(false);
  });
});

describe('nextDateTimeFieldState, iOS', () => {
  const platform: DateTimeFieldPlatform = 'ios';

  it('opens on the date half', () => {
    expect(nextDateTimeFieldState(platform, CLOSED_DATE_TIME_FIELD, 'open')).toEqual(OPEN_DATE);
  });

  it('stays open on a wheel change in either half', () => {
    expect(nextDateTimeFieldState(platform, OPEN_DATE, 'set')).toEqual(OPEN_DATE);
    expect(nextDateTimeFieldState(platform, OPEN_TIME, 'set')).toEqual(OPEN_TIME);
  });

  it('closes on the explicit Done control', () => {
    expect(nextDateTimeFieldState(platform, OPEN_DATE, 'done')).toEqual(CLOSED_DATE_TIME_FIELD);
    expect(nextDateTimeFieldState(platform, OPEN_TIME, 'done')).toEqual(CLOSED_DATE_TIME_FIELD);
  });

  it('closes if the native picker reports a dismissal', () => {
    expect(nextDateTimeFieldState(platform, OPEN_TIME, 'dismissed')).toEqual(CLOSED_DATE_TIME_FIELD);
  });

  it('reaches the time half through the mode chips', () => {
    expect(nextDateTimeFieldState(platform, OPEN_DATE, 'switchMode')).toEqual(OPEN_TIME);
    expect(nextDateTimeFieldState(platform, OPEN_TIME, 'switchMode')).toEqual(OPEN_DATE);
  });

  it('keeps the mode while the time half is being edited and closes on Done', () => {
    const afterSwitch = nextDateTimeFieldState(platform, OPEN_DATE, 'switchMode');
    const afterChange = nextDateTimeFieldState(platform, afterSwitch, 'set');
    const afterDone = nextDateTimeFieldState(platform, afterChange, 'done');
    expect(afterChange.mode).toBe('time');
    expect(afterChange.visible).toBe(true);
    expect(afterDone.visible).toBe(false);
  });
});

describe('nextDateTimeFieldState, shared contract', () => {
  it('never leaves the control open after done or dismissed on either platform', () => {
    for (const platform of ['ios', 'android'] as const) {
      for (const current of [CLOSED_DATE_TIME_FIELD, OPEN_DATE, OPEN_TIME]) {
        expect(nextDateTimeFieldState(platform, current, 'done').visible).toBe(false);
        expect(nextDateTimeFieldState(platform, current, 'dismissed').visible).toBe(false);
      }
    }
  });

  it('only ever reaches the time half while visible', () => {
    for (const platform of ['ios', 'android'] as const) {
      const time = nextDateTimeFieldState(platform, OPEN_DATE, 'switchMode');
      expect(time.mode).toBe('time');
      expect(time.visible).toBe(true);
    }
  });
});
