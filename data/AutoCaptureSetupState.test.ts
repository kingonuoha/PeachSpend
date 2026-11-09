import { describe, expect, it } from 'vitest';
import {
  AUTOSTART_GUIDE,
  createOptionalAutoCaptureSourceAdapter,
  getAutostartGuide,
} from './AutoCaptureSource';

// Phase 14 M1: setup guide state. Battery exemption is API detectable (Kotlin
// PowerManager path, adapter getBatteryExemption); autostart has no detection
// API, so the guide is static instructions and must never read as a sensed
// on or off state.
describe('auto-capture setup guide state', () => {
  it('exposes a generic row plus brand rows with non empty steps', () => {
    const guide = getAutostartGuide();
    expect(guide).toBe(AUTOSTART_GUIDE);
    expect(guide.length).toBeGreaterThanOrEqual(7);
    expect(guide[0]?.brand).toBe('Generic Android');
    for (const entry of guide) {
      expect(entry.brand.trim().length).toBeGreaterThan(0);
      expect(entry.systemPath.trim().length).toBeGreaterThan(0);
      expect(entry.steps.length).toBeGreaterThanOrEqual(2);
      for (const step of entry.steps) expect(step.trim().length).toBeGreaterThan(0);
    }
  });

  it('never claims a sensed autostart state in any instruction row', () => {
    const sensed = /\b(detected|not detected|enabled on this device|disabled on this device|currently allowed|currently blocked)\b/i;
    for (const entry of AUTOSTART_GUIDE) {
      expect(entry.systemPath).not.toMatch(sensed);
      for (const step of entry.steps) expect(step).not.toMatch(sensed);
    }
  });

  it('unavailable adapter reports honest setup fallbacks', async () => {
    const android = createOptionalAutoCaptureSourceAdapter('android');
    const ios = createOptionalAutoCaptureSourceAdapter('ios');
    await expect(android.getBatteryExemption?.()).resolves.toEqual({ exempt: false });
    await expect(ios.getBatteryExemption?.()).resolves.toEqual({ exempt: false });
    await expect(android.getGuardState?.()).resolves.toEqual({
      running: false,
      captureEnabled: false,
      listenerGranted: false,
    });
    await expect(android.openBatterySettings?.()).resolves.toBeUndefined();
    await expect(ios.openBatterySettings?.()).resolves.toBeUndefined();
  });
});
