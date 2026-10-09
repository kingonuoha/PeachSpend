import Constants from 'expo-constants';
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
