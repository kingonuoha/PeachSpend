import { Platform } from 'react-native';
import { requireOptionalNativeModule, type EventSubscription } from 'expo-modules-core';
import type {
  AutoCapturePermissionState,
  AutoCapturePermission,
  AutoCaptureSourceDescriptor,
  BatteryExemptionState,
  DetectionAlertContent,
  DetectionAlertPostResult,
  GuardServiceState,
  NativeAutoCaptureNotification,
  NativeAutoCaptureSourceAdapter,
  PendingAlertAction,
} from './contracts';
import { createOptionalAutoCaptureSourceAdapter, sanitizeNativeNotification } from './AutoCaptureSource';

interface NativeAutoCaptureModule {
  getPermissionState(): Promise<AutoCapturePermissionState>;
  getSupportedSources(): Promise<AutoCaptureSourceDescriptor[]>;
  openSystemSettings(): Promise<void>;
  addListener(eventName: 'onNotification', listener: (notification: NativeAutoCaptureNotification) => void): EventSubscription;
  setLifecycle(enabled: boolean, permission: AutoCapturePermission): Promise<void>;
  // Phase 14 M1 additions. Optional so a dev build compiled before M1 keeps
  // running the JS with an honest fallback instead of crashing on a missing
  // async function.
  getBatteryExemption?(): Promise<BatteryExemptionState>;
  getGuardState?(): Promise<GuardServiceState>;
  openBatterySettings?(): Promise<void>;
  // Phase 14 M2 additions. Same optional rule: older native builds report not
  // posted and drain nothing, so the inbox remains the source of truth.
  showDetectionAlert?(draftId: string, merchant: string, amountText: string, sourceLabel: string, timeText: string): Promise<DetectionAlertPostResult>;
  cancelDetectionAlert?(draftId: string): Promise<void>;
  addListener(eventName: 'onAlertAction', listener: (action: { draftId?: string; action?: string }) => void): EventSubscription;
  consumePendingAlertAction?(): Promise<{ draftId?: string; action?: string; receivedAt?: string } | null>;
}

function getNativeModule(): NativeAutoCaptureModule | null {
  if (Platform.OS !== 'android') return null;
  return requireOptionalNativeModule<NativeAutoCaptureModule>('ExpoAutoCapture');
}

class OptionalNativeAutoCaptureAdapter implements NativeAutoCaptureSourceAdapter {
  readonly platform = 'android' as const;
  readonly capability = 'available' as const;

  constructor(private readonly nativeModule: NativeAutoCaptureModule) {}
  getPermissionState(): Promise<AutoCapturePermissionState> { return this.nativeModule.getPermissionState(); }
  getSupportedSources(): Promise<AutoCaptureSourceDescriptor[]> { return this.nativeModule.getSupportedSources(); }
  openSystemSettings(): Promise<void> { return this.nativeModule.openSystemSettings(); }

  async getBatteryExemption(): Promise<BatteryExemptionState> {
    // No detection on older native builds: report not exempt so the setup
    // guide offers the settings path instead of a false all clear.
    if (typeof this.nativeModule.getBatteryExemption !== 'function') return { exempt: false };
    return this.nativeModule.getBatteryExemption();
  }

  async getGuardState(): Promise<GuardServiceState> {
    if (typeof this.nativeModule.getGuardState !== 'function') {
      return { running: false, captureEnabled: false, listenerGranted: false };
    }
    return this.nativeModule.getGuardState();
  }

  async openBatterySettings(): Promise<void> {
    if (typeof this.nativeModule.openBatterySettings !== 'function') {
      return this.nativeModule.openSystemSettings();
    }
    return this.nativeModule.openBatterySettings();
  }

  // Phase 14 M2 delegates. Older native builds without the alert functions
  // report not posted and drain nothing, so the inbox stays authoritative.
  async showDetectionAlert(input: DetectionAlertContent): Promise<DetectionAlertPostResult> {
    if (typeof this.nativeModule.showDetectionAlert !== 'function') return { posted: false };
    return this.nativeModule.showDetectionAlert(
      input.draftId,
      input.merchant,
      input.amountText,
      input.sourceLabel,
      input.timeText,
    );
  }

  async cancelDetectionAlert(draftId: string): Promise<void> {
    if (typeof this.nativeModule.cancelDetectionAlert !== 'function') return;
    await this.nativeModule.cancelDetectionAlert(draftId);
  }

  subscribeAlertActions(listener: (action: PendingAlertAction) => void): () => void {
    // Gated on the M2 marker so an older native build never subscribes to an
    // event name it did not declare.
    if (typeof this.nativeModule.consumePendingAlertAction !== 'function') return () => undefined;
    try {
      const subscription = this.nativeModule.addListener('onAlertAction', raw => {
        const action = parseAlertAction(raw);
        if (action) listener(action);
      });
      return () => subscription.remove();
    } catch {
      return () => undefined;
    }
  }

  async consumePendingAlertAction(): Promise<PendingAlertAction | null> {
    if (typeof this.nativeModule.consumePendingAlertAction !== 'function') return null;
    return parseAlertAction(await this.nativeModule.consumePendingAlertAction());
  }

  subscribe(listener: (notification: NativeAutoCaptureNotification) => void): () => void {
    const subscription = this.nativeModule.addListener('onNotification', notification => {
      const safe = sanitizeNativeNotification(notification);
      if (safe) listener(safe);
    });
    return () => subscription.remove();
  }

  setLifecycle(enabled: boolean, permission: AutoCapturePermission): void {
    void this.nativeModule.setLifecycle(enabled, permission);
  }
}

export function createNativeAutoCaptureAdapter(): NativeAutoCaptureSourceAdapter {
  const nativeModule = getNativeModule();
  if (nativeModule) return new OptionalNativeAutoCaptureAdapter(nativeModule);
  return createOptionalAutoCaptureSourceAdapter(Platform.OS === 'ios' ? 'ios' : 'android');
}

// Validates one receiver action record. Anything malformed (missing draft,
// unknown action, non numeric timestamp) reads as null so a corrupt
// SharedPreferences slot can never confirm or snooze the wrong draft.
export function parseAlertAction(raw: { draftId?: string; action?: string; receivedAt?: string } | null | undefined): PendingAlertAction | null {
  if (!raw) return null;
  const draftId = raw.draftId?.trim();
  if (!draftId) return null;
  if (raw.action !== 'confirm' && raw.action !== 'snooze') return null;
  const receivedAt = Number(raw.receivedAt);
  if (!Number.isFinite(receivedAt) || receivedAt <= 0) return null;
  return { draftId, action: raw.action, receivedAt };
}
