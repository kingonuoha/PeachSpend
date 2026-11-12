import { AndroidConfig, withAndroidManifest, type ConfigPlugin } from '@expo/config-plugins';
import type { AndroidManifest, ManifestApplication } from '@expo/config-plugins/build/android/Manifest';

const WIDGET_PROVIDER = 'expo.modules.homewidget.PeachSpendWidgetProvider';
const WIDGET_UPDATE_ACTION = 'android.appwidget.action.APPWIDGET_UPDATE';
const DATE_CHANGED_ACTION = 'android.intent.action.DATE_CHANGED';
const TIME_SET_ACTION = 'android.intent.action.TIME_SET';
const TIMEZONE_CHANGED_ACTION = 'android.intent.action.TIMEZONE_CHANGED';
const MY_PACKAGE_REPLACED_ACTION = 'android.intent.action.MY_PACKAGE_REPLACED';
const WIDGET_PROVIDER_META_NAME = 'android.appwidget.provider';
const WIDGET_PROVIDER_META_RESOURCE = '@xml/peachspend_widget_info';

function receiversOf(application: ManifestApplication): Record<string, unknown>[] {
  const existing = (application as unknown as { receiver?: Record<string, unknown>[] }).receiver ?? [];
  (application as unknown as { receiver: Record<string, unknown>[] }).receiver = existing;
  return existing;
}

function hasName(entries: Record<string, unknown>[], name: string): boolean {
  return entries.some(entry => (entry.$ as { 'android:name'?: string } | undefined)?.['android:name'] === name);
}

// Pure manifest transform for PeachSpend Android Home Screen Widget.
// Idempotent: a second prebuild pass adds nothing, and never adds any permissions.
export function applyHomeWidgetManifest(manifest: AndroidManifest): AndroidManifest {
  const application = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
  const receivers = receiversOf(application);
  if (!hasName(receivers, WIDGET_PROVIDER)) {
    receivers.push({
      $: {
        'android:name': WIDGET_PROVIDER,
        'android:exported': 'true',
        'android:label': 'PeachSpend',
      },
      'intent-filter': [
        {
          action: [
            { $: { 'android:name': WIDGET_UPDATE_ACTION } },
            { $: { 'android:name': DATE_CHANGED_ACTION } },
            { $: { 'android:name': TIME_SET_ACTION } },
            { $: { 'android:name': TIMEZONE_CHANGED_ACTION } },
            { $: { 'android:name': MY_PACKAGE_REPLACED_ACTION } },
          ],
        },
      ],
      'meta-data': [
        {
          $: {
            'android:name': WIDGET_PROVIDER_META_NAME,
            'android:resource': WIDGET_PROVIDER_META_RESOURCE,
          },
        },
      ],
    });
  }
  return manifest;
}

const withHomeWidget: ConfigPlugin = config =>
  withAndroidManifest(config, configWithManifest => {
    configWithManifest.modResults = applyHomeWidgetManifest(configWithManifest.modResults);
    return configWithManifest;
  });

export default withHomeWidget;
