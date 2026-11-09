import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mutable runtime state the mocked native layer reads lazily, so a single
// module mock can stand in for Expo Go, a real build, and web across tests.
const state = vi.hoisted(() => ({
  appOwnership: null as string | null,
  executionEnvironment: 'bare' as string,
  platformOS: 'ios' as string,
  nativeModules: {} as Record<string, unknown>,
}));

vi.mock('expo-constants', () => ({
  default: {
    get appOwnership() {
      return state.appOwnership;
    },
    get executionEnvironment() {
      return state.executionEnvironment;
    },
  },
}));

vi.mock('react-native', () => ({
  Platform: {
    get OS() {
      return state.platformOS;
    },
  },
  NativeModules: new Proxy(
    {},
    {
      get: (_target, name) => state.nativeModules[String(name)],
    }
  ),
}));

async function importHelper() {
  vi.resetModules();
  return import('./runtimeEnvironment');
}

beforeEach(() => {
  state.appOwnership = null;
  state.executionEnvironment = 'bare';
  state.platformOS = 'ios';
  state.nativeModules = {};
  vi.stubGlobal('__DEV__', true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('runtime detection', () => {
  it('reports Expo Go when appOwnership is expo', async () => {
    state.appOwnership = 'expo';
    const { isExpoGoRuntime } = await importHelper();

    expect(isExpoGoRuntime()).toBe(true);
  });

  it('reports Expo Go for the store client execution environment', async () => {
    state.executionEnvironment = 'storeClient';
    const { isExpoGoRuntime } = await importHelper();

    expect(isExpoGoRuntime()).toBe(true);
  });

  it('reports a real build when neither Expo Go signal is present', async () => {
    const { isExpoGoRuntime, canUseNativeRuntime } = await importHelper();

    expect(isExpoGoRuntime()).toBe(false);
    expect(canUseNativeRuntime('expo-notifications')).toBe(true);
  });

  it('refuses a native runtime in Expo Go and warns once', async () => {
    state.executionEnvironment = 'storeClient';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { canUseNativeRuntime } = await importHelper();

    expect(canUseNativeRuntime('expo-background-task')).toBe(false);
    expect(canUseNativeRuntime('expo-background-task')).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('hasNativeModules', () => {
  it('is false on web even when the module is registered', async () => {
    state.platformOS = 'web';
    state.nativeModules = { ExpoNotificationModule: {} };
    const { hasNativeModules } = await importHelper();

    expect(hasNativeModules([])).toBe(false);
    expect(hasNativeModules(['ExpoNotificationModule'])).toBe(false);
  });

  it('is true only when every named module is registered', async () => {
    state.nativeModules = { ExpoShareIntentModule: {}, ExpoNotificationModule: {} };
    const { hasNativeModules } = await importHelper();

    expect(hasNativeModules(['ExpoShareIntentModule'])).toBe(true);
    expect(hasNativeModules(['ExpoShareIntentModule', 'ExpoNotificationModule'])).toBe(true);
    expect(hasNativeModules(['ExpoShareIntentModule', 'MissingModule'])).toBe(false);
  });
});

describe('loadNativeModule', () => {
  it('returns available with the imported module', async () => {
    state.nativeModules = { ExpoNotificationModule: {} };
    const { loadNativeModule } = await importHelper();
    const loaded = { requestPermissionsAsync: vi.fn() };

    const result = await loadNativeModule(async () => loaded, ['ExpoNotificationModule']);

    expect(result.reason).toBe('available');
    expect(result.module).toBe(loaded);
    expect(result.error).toBeUndefined();
  });

  it('returns unsupported_expo_go when Expo Go does not ship the module', async () => {
    state.executionEnvironment = 'storeClient';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { loadNativeModule } = await importHelper();
    const importer = vi.fn(async () => ({ ok: true }));

    const result = await loadNativeModule(importer, ['ExpoShareIntentModule']);

    expect(result.reason).toBe('unsupported_expo_go');
    expect(result.module).toBeNull();
    expect(importer).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('returns native_module_missing in a real build without the module', async () => {
    const { loadNativeModule } = await importHelper();

    const result = await loadNativeModule(async () => ({ ok: true }), ['MissingModule']);

    expect(result.reason).toBe('native_module_missing');
    expect(result.module).toBeNull();
  });

  it('returns unavailable_on_web without calling the importer', async () => {
    state.platformOS = 'web';
    state.nativeModules = { ExpoNotificationModule: {} };
    const { loadNativeModule } = await importHelper();
    const importer = vi.fn(async () => ({ ok: true }));

    const result = await loadNativeModule(importer, ['ExpoNotificationModule']);

    expect(result.reason).toBe('unavailable_on_web');
    expect(result.module).toBeNull();
    expect(importer).not.toHaveBeenCalled();
  });

  it('returns import_failed with the original error instead of throwing', async () => {
    state.nativeModules = { ExpoNotificationModule: {} };
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { loadNativeModule } = await importHelper();
    const boom = new Error('native barrel exploded');

    const result = await loadNativeModule(async () => {
      throw boom;
    }, ['ExpoNotificationModule']);

    expect(result.reason).toBe('import_failed');
    expect(result.module).toBeNull();
    expect(result.error).toBe(boom);
  });

  it('stays silent outside __DEV__', async () => {
    vi.stubGlobal('__DEV__', false);
    state.executionEnvironment = 'storeClient';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { loadNativeModule } = await importHelper();

    const result = await loadNativeModule(async () => ({ ok: true }), ['MissingModule']);

    expect(result.reason).toBe('unsupported_expo_go');
    expect(warn).not.toHaveBeenCalled();
  });
});
