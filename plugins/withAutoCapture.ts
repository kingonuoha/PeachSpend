import { AndroidConfig, withAndroidManifest, type ConfigPlugin } from '@expo/config-plugins';

const SERVICE_NAME = '.autocapture.AutoCaptureNotificationListenerService';
const LISTENER_PERMISSION = 'android.permission.BIND_NOTIFICATION_LISTENER_SERVICE';
const LISTENER_ACTION = 'android.service.notification.NotificationListenerService';

const withAutoCapture: ConfigPlugin = config => withAndroidManifest(config, configWithManifest => {
  const manifest = configWithManifest.modResults;
  const application = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
  const services = application.service ?? [];
  if (!services.some(service => service.$['android:name'] === SERVICE_NAME)) {
    services.push({
      $: {
        'android:name': SERVICE_NAME,
        'android:permission': LISTENER_PERMISSION,
        'android:exported': 'true',
      },
      'intent-filter': [{ action: [{ $: { 'android:name': LISTENER_ACTION } }] }],
    });
  }
  application.service = services;
  return configWithManifest;
});

export default withAutoCapture;
