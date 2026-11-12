import { describe, expect, it } from 'vitest';
import type { AndroidManifest } from '@expo/config-plugins/build/android/Manifest';
import { applyAutoCaptureManifest } from './withAutoCapture';

const LISTENER = 'expo.modules.autocapture.AutoCaptureNotificationListenerService';
const GUARD = 'expo.modules.autocapture.AutoCaptureGuardService';
const RECEIVER = 'expo.modules.autocapture.AutoCaptureBootReceiver';
const ALERT_RECEIVER = 'expo.modules.autocapture.AutoCaptureAlertReceiver';
const KEEP_ALIVE_RECEIVER = 'expo.modules.autocapture.AutoCaptureKeepAliveReceiver';

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
    const boot = app.receiver?.find(entry => entry.$?.['android:name'] === RECEIVER);
    expect(boot?.$?.['android:directBootAware']).toBe('true');
    const raw = JSON.stringify(out);
    expect(raw).toContain('android.intent.action.BOOT_COMPLETED');
    expect(raw).toContain('android.intent.action.LOCKED_BOOT_COMPLETED');
    expect(raw).toContain('android.intent.action.MY_PACKAGE_REPLACED');
  });

  it('registers the alert and keep-alive receivers unexported with no intent filter', () => {
    const out = applyAutoCaptureManifest(blankManifest());
    const app = (out.manifest?.application?.[0] ?? {}) as {
      service?: { $?: Record<string, string> }[];
      receiver?: { $?: Record<string, string>; 'intent-filter'?: unknown }[];
    };
    expect(namesOf(app.receiver)).toContain(ALERT_RECEIVER);
    expect(namesOf(app.receiver)).toContain(KEEP_ALIVE_RECEIVER);
    const alert = app.receiver?.find(entry => entry.$?.['android:name'] === ALERT_RECEIVER);
    const keepAlive = app.receiver?.find(entry => entry.$?.['android:name'] === KEEP_ALIVE_RECEIVER);
    expect(alert?.$?.['android:exported']).toBe('false');
    expect(alert?.['intent-filter']).toBeUndefined();
    expect(keepAlive?.$?.['android:exported']).toBe('false');
    expect(keepAlive?.['intent-filter']).toBeUndefined();
  });

  it('is idempotent across repeated prebuild passes', () => {
    const once = applyAutoCaptureManifest(blankManifest());
    const before = JSON.stringify(once);
    const twice = applyAutoCaptureManifest(once);
    expect(JSON.stringify(twice)).toBe(before);
  });
});
