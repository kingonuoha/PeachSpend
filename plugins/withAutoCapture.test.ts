import { describe, expect, it } from 'vitest';
import type { AndroidManifest } from '@expo/config-plugins/build/android/Manifest';
import { applyAutoCaptureManifest } from './withAutoCapture';

const LISTENER = 'expo.modules.autocapture.AutoCaptureNotificationListenerService';
const GUARD = 'expo.modules.autocapture.AutoCaptureGuardService';
const RECEIVER = 'expo.modules.autocapture.AutoCaptureBootReceiver';
const ALERT_RECEIVER = 'expo.modules.autocapture.AutoCaptureAlertReceiver';

function blankManifest(): AndroidManifest {
  return {
    manifest: {
      $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' },
      'uses-permission': [],
      application: [{ $: { 'android:name': '.MainApplication' } }],
    },
  } as unknown as AndroidManifest;
}

function namesOf(entries: { $?: { 'android:name'?: string } }[] | undefined): string[] {
  return (entries ?? []).map(entry => entry.$?.['android:name'] ?? '');
}

describe('withAutoCapture manifest', () => {
  it('adds boot, foreground service, notice, full screen intent, and battery permissions only', () => {
    const out = applyAutoCaptureManifest(blankManifest());
    const permissions = ((out.manifest?.['uses-permission'] ?? []) as { $?: { 'android:name'?: string } }[]).map(
      entry => entry.$?.['android:name'],
    );
    for (const required of [
      'android.permission.RECEIVE_BOOT_COMPLETED',
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_DATA_SYNC',
      'android.permission.POST_NOTIFICATIONS',
      'android.permission.USE_FULL_SCREEN_INTENT',
      'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
    ]) {
      expect(permissions).toContain(required);
    }
    expect(permissions).not.toContain('android.permission.SYSTEM_ALERT_WINDOW');
    expect(permissions.some(name => (name ?? '').includes('SMS'))).toBe(false);
  });

  it('registers the listener, guard service with dataSync type, and boot receiver', () => {
    const out = applyAutoCaptureManifest(blankManifest());
    const app = (out.manifest?.application?.[0] ?? {}) as {
      service?: { $?: Record<string, string> }[];
      receiver?: { $?: Record<string, string>; 'intent-filter'?: unknown }[];
    };
    expect(namesOf(app.service)).toContain(LISTENER);
    expect(namesOf(app.service)).toContain(GUARD);
    const guard = app.service?.find(entry => entry.$?.['android:name'] === GUARD);
    expect(guard?.$?.['android:foregroundServiceType']).toBe('dataSync');
    expect(namesOf(app.receiver)).toContain(RECEIVER);
    const raw = JSON.stringify(out);
    expect(raw).toContain('android.intent.action.BOOT_COMPLETED');
  });

  it('registers the alert receiver unexported with no intent filter', () => {
    const out = applyAutoCaptureManifest(blankManifest());
    const app = (out.manifest?.application?.[0] ?? {}) as {
      service?: { $?: Record<string, string> }[];
      receiver?: { $?: Record<string, string>; 'intent-filter'?: unknown }[];
    };
    expect(namesOf(app.receiver)).toContain(ALERT_RECEIVER);
    const alert = app.receiver?.find(entry => entry.$?.['android:name'] === ALERT_RECEIVER);
    expect(alert?.$?.['android:exported']).toBe('false');
    expect(alert?.['intent-filter']).toBeUndefined();
  });

  it('is idempotent across repeated prebuild passes', () => {
    const once = applyAutoCaptureManifest(blankManifest());
    const before = JSON.stringify(once);
    const twice = applyAutoCaptureManifest(once);
    expect(JSON.stringify(twice)).toBe(before);
  });
});
