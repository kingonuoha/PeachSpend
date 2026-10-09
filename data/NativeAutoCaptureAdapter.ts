import { Platform } from 'react-native';
import { requireOptionalNativeModule, type EventSubscription } from 'expo-modules-core';
import type {
  AutoCapturePermissionState,
  AutoCapturePermission,
  AutoCaptureSourceDescriptor,
  NativeAutoCaptureNotification,
  NativeAutoCaptureSourceAdapter,
} from './contracts';
import { createOptionalAutoCaptureSourceAdapter, sanitizeNativeNotification } from './AutoCaptureSource';

interface NativeAutoCaptureModule {
  getPermissionState(): Promise<AutoCapturePermissionState>;
  getSupportedSources(): Promise<AutoCaptureSourceDescriptor[]>;
  openSystemSettings(): Promise<void>;
  addListener(eventName: 'onNotification', listener: (notification: NativeAutoCaptureNotification) => void): EventSubscription;
  setLifecycle(enabled: boolean, permission: AutoCapturePermission): Promise<void>;
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
