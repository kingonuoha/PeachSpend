import Constants from 'expo-constants';
import { NativeModules, Platform } from 'react-native';
import { logger } from './logger';

const expoGoRuntime =
  Constants.appOwnership === 'expo' || Constants.executionEnvironment === 'storeClient';
const notices = new Set<string>();

export function isExpoGoRuntime(): boolean {
  return expoGoRuntime;
}

export function canUseNativeRuntime(moduleName: string): boolean {
  if (!expoGoRuntime) return true;

  if (__DEV__ && !notices.has(moduleName)) {
    notices.add(moduleName);
    logger.warn(`RuntimeGuard: ${moduleName} disabled in Expo Go`);
  }

  return false;
}

/**
 * True when every named native module is registered with the current runtime.
 * Web has no native module registry, so it always reports false.
 */
export function hasNativeModules(names: string[]): boolean {
  if (Platform.OS === 'web') return false;

  return names.every((name) => NativeModules[name] != null);
}

export type NativeLoadReason =
  | 'available'
  | 'unsupported_expo_go'
  | 'native_module_missing'
  | 'unavailable_on_web'
  | 'import_failed';

export type NativeLoad<T> = {
  module: T | null;
  reason: NativeLoadReason;
  error?: unknown;
};

/**
 * Loads a native-backed module without ever throwing. Callers branch on
 * `reason` and show their honest fallback instead of a red screen.
 *
 * `requiredModules` names the native modules the import needs. A missing one in
 * Expo Go means the shell does not ship it (`unsupported_expo_go`); a missing
 * one in a real build means the module was not linked (`native_module_missing`).
 */
export async function loadNativeModule<T>(
  importer: () => Promise<T>,
  requiredModules: string[]
): Promise<NativeLoad<T>> {
  if (Platform.OS === 'web') {
    logNativeLoadFailure('unavailable_on_web', requiredModules);
    return { module: null, reason: 'unavailable_on_web' };
  }

  if (requiredModules.length > 0 && !hasNativeModules(requiredModules)) {
    const reason: NativeLoadReason = expoGoRuntime ? 'unsupported_expo_go' : 'native_module_missing';
    logNativeLoadFailure(reason, requiredModules);
    return { module: null, reason };
  }

  try {
    const module = await importer();
    return { module, reason: 'available' };
  } catch (error) {
    logNativeLoadFailure('import_failed', requiredModules, error);
    return { module: null, reason: 'import_failed', error };
  }
}

function logNativeLoadFailure(
  reason: NativeLoadReason,
  requiredModules: string[],
  error?: unknown
): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return;

  const modules = requiredModules.length > 0 ? requiredModules.join(', ') : 'module';
  const detail = error instanceof Error ? `: ${error.message}` : '';
  logger.warn(`RuntimeGuard: native load ${reason} for ${modules}${detail}`);
}
