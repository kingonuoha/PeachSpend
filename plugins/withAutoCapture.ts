import { AndroidConfig, withAndroidManifest, type ConfigPlugin } from '@expo/config-plugins';
import type { AndroidManifest, ManifestApplication } from '@expo/config-plugins/build/android/Manifest';

const LISTENER_SERVICE = 'expo.modules.autocapture.AutoCaptureNotificationListenerService';
const GUARD_SERVICE = 'expo.modules.autocapture.AutoCaptureGuardService';
const BOOT_RECEIVER = 'expo.modules.autocapture.AutoCaptureBootReceiver';
const ALERT_RECEIVER = 'expo.modules.autocapture.AutoCaptureAlertReceiver';
const LISTENER_PERMISSION = 'android.permission.BIND_NOTIFICATION_LISTENER_SERVICE';
const LISTENER_ACTION = 'android.service.notification.NotificationListenerService';
const BOOT_COMPLETED_ACTION = 'android.intent.action.BOOT_COMPLETED';
const GUARD_FOREGROUND_TYPE = 'dataSync';

// Phase 14 M1 manifest surface. Adds only what the always on listener needs:
// boot re arm, the foreground guard service, its visible notice channel, and
// the battery exemption request flow. Phase 14 M2 adds the rich detection
// alert surface: the full screen intent permission plus the alert action
// receiver. An explicit broadcast receiver only, so it stays unexported.
// Never adds SYSTEM_ALERT_WINDOW (blocked in app.json, DEC-14-05), SMS
// permissions, or any network destination.
const REQUIRED_PERMISSIONS = [
  'android.permission.RECEIVE_BOOT_COMPLETED',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_DATA_SYNC',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.USE_FULL_SCREEN_INTENT',
  'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
];

function servicesOf(application: ManifestApplication): Record<string, unknown>[] {
  const existing = (application as unknown as { service?: Record<string, unknown>[] }).service ?? [];
  (application as unknown as { service: Record<string, unknown>[] }).service = existing;
  return existing;
}

function receiversOf(application: ManifestApplication): Record<string, unknown>[] {
  const existing = (application as unknown as { receiver?: Record<string, unknown>[] }).receiver ?? [];
  (application as unknown as { receiver: Record<string, unknown>[] }).receiver = existing;
  return existing;
}

function hasName(entries: Record<string, unknown>[], name: string): boolean {
  return entries.some(entry => (entry.$ as { 'android:name'?: string } | undefined)?.['android:name'] === name);
}

// Pure manifest transform, exported for the M1 pinning test. Idempotent: a
// second prebuild pass adds nothing.
export function applyAutoCaptureManifest(manifest: AndroidManifest): AndroidManifest {
  for (const permission of REQUIRED_PERMISSIONS) {
    AndroidConfig.Permissions.ensurePermission(manifest, permission);
  }
  const application = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
  const services = servicesOf(application);
  if (!hasName(services, LISTENER_SERVICE)) {
    services.push({
      $: {
        'android:name': LISTENER_SERVICE,
        'android:permission': LISTENER_PERMISSION,
        'android:exported': 'true',
      },
      'intent-filter': [{ action: [{ $: { 'android:name': LISTENER_ACTION } }] }],
    });
  }
  if (!hasName(services, GUARD_SERVICE)) {
    services.push({
      $: {
        'android:name': GUARD_SERVICE,
        'android:exported': 'false',
        'android:foregroundServiceType': GUARD_FOREGROUND_TYPE,
      },
    });
  }
  const receivers = receiversOf(application);
  if (!hasName(receivers, BOOT_RECEIVER)) {
    receivers.push({
      $: {
        'android:name': BOOT_RECEIVER,
        'android:exported': 'true',
      },
      'intent-filter': [{ action: [{ $: { 'android:name': BOOT_COMPLETED_ACTION } }] }],
    });
  }
  // Phase 14 M2 alert action receiver. It answers only our own explicit
  // broadcasts from the detection alert actions, so no intent filter and no
  // export: nothing outside this app can reach it.
  if (!hasName(receivers, ALERT_RECEIVER)) {
    receivers.push({
      $: {
        'android:name': ALERT_RECEIVER,
        'android:exported': 'false',
      },
    });
  }
  return manifest;
}

const withAutoCapture: ConfigPlugin = config =>
  withAndroidManifest(config, configWithManifest => {
    configWithManifest.modResults = applyAutoCaptureManifest(configWithManifest.modResults);
    return configWithManifest;
  });

export default withAutoCapture;
