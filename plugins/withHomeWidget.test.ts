import { describe, expect, it } from 'vitest';
import type { AndroidManifest } from '@expo/config-plugins/build/android/Manifest';
import { applyHomeWidgetManifest } from './withHomeWidget';

const WIDGET_PROVIDER = 'expo.modules.homewidget.PeachSpendWidgetProvider';

function blankManifest(): AndroidManifest {
  return {
    manifest: {
      $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' },
      'uses-permission': [],
      application: [{ $: { 'android:name': '.MainApplication' } }],
    },
  } as unknown as AndroidManifest;
}

describe('withHomeWidget manifest', () => {
  it('registers the PeachSpendWidgetProvider receiver as exported with appwidget metadata and filters', () => {
    const out = applyHomeWidgetManifest(blankManifest());
    const app = (out.manifest?.application?.[0] ?? {}) as {
      receiver?: {
        $?: Record<string, string>;
        'intent-filter'?: { action?: { $?: Record<string, string> }[] }[];
        'meta-data'?: { $?: Record<string, string> }[];
      }[];
    };
    const widgetReceiver = app.receiver?.find(entry => entry.$?.['android:name'] === WIDGET_PROVIDER);
    expect(widgetReceiver).toBeDefined();
    expect(widgetReceiver?.$?.['android:exported']).toBe('true');

    const actions = (widgetReceiver?.['intent-filter']?.[0]?.action ?? []).map(a => a.$?.['android:name']);
    expect(actions).toContain('android.appwidget.action.APPWIDGET_UPDATE');
    expect(actions).toContain('android.intent.action.DATE_CHANGED');
    expect(actions).toContain('android.intent.action.TIME_SET');
    expect(actions).toContain('android.intent.action.TIMEZONE_CHANGED');
    expect(actions).toContain('android.intent.action.MY_PACKAGE_REPLACED');

    const meta = widgetReceiver?.['meta-data']?.[0]?.$;
    expect(meta?.['android:name']).toBe('android.appwidget.provider');
    expect(meta?.['android:resource']).toBe('@xml/peachspend_widget_info');
  });

  it('adds zero unapproved permissions', () => {
    const out = applyHomeWidgetManifest(blankManifest());
    const permissions = (out.manifest?.['uses-permission'] ?? []) as { $?: Record<string, string> }[];
    expect(permissions).toHaveLength(0);
  });

  it('is idempotent across repeated prebuild passes', () => {
    const once = applyHomeWidgetManifest(blankManifest());
    const before = JSON.stringify(once);
    const twice = applyHomeWidgetManifest(once);
    expect(JSON.stringify(twice)).toBe(before);
  });
});
