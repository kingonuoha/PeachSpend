import { beforeEach, describe, expect, it, vi } from 'vitest';
import { notificationService, toDeviceAlertPermissionState } from './NotificationService';

// The service loads expo-notifications through a raw require at module top,
// which vitest cannot intercept, so that load falls through to the real
// package and lands on the caught null path. The live grant paths below run
// through the dynamic import seam, which this mock does intercept. The
// database is stubbed because the permission methods never touch it.
const notificationsMock = vi.hoisted(() => ({
  getPermissionsAsync: vi.fn(),
  requestPermissionsAsync: vi.fn(),
  setNotificationHandler: vi.fn(),
}));

vi.mock('react-native', () => ({
  Platform: { OS: 'android' },
}));
vi.mock('expo-constants', () => ({
  default: { appOwnership: null, executionEnvironment: 'standalone' },
}));
vi.mock('expo-notifications', () => notificationsMock);
vi.mock('./DatabaseService', () => ({
  databaseService: { getSetting: vi.fn(), insertNotification: vi.fn() },
}));

describe('toDeviceAlertPermissionState', () => {
  it('passes the three OS states through and reads anything else as unavailable', () => {
    expect(toDeviceAlertPermissionState('granted')).toBe('granted');
    expect(toDeviceAlertPermissionState('denied')).toBe('denied');
    expect(toDeviceAlertPermissionState('undetermined')).toBe('undetermined');
    expect(toDeviceAlertPermissionState('provisional')).toBe('unavailable');
    expect(toDeviceAlertPermissionState(undefined)).toBe('unavailable');
  });
});

describe('getDeviceAlertPermission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports the live OS grant without prompting', async () => {
    notificationsMock.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
    expect(await notificationService.getDeviceAlertPermission()).toBe('granted');
    expect(notificationsMock.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('reports denied and undetermined honestly', async () => {
    notificationsMock.getPermissionsAsync.mockResolvedValue({ status: 'denied' });
    expect(await notificationService.getDeviceAlertPermission()).toBe('denied');
    notificationsMock.getPermissionsAsync.mockResolvedValue({ status: 'undetermined' });
    expect(await notificationService.getDeviceAlertPermission()).toBe('undetermined');
  });

  it('reports unavailable when the read fails', async () => {
    notificationsMock.getPermissionsAsync.mockRejectedValue(new Error('no runtime'));
    expect(await notificationService.getDeviceAlertPermission()).toBe('unavailable');
  });
});

describe('requestDeviceAlertPermission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true only when the OS grants', async () => {
    notificationsMock.requestPermissionsAsync.mockResolvedValue({ status: 'granted' });
    expect(await notificationService.requestDeviceAlertPermission()).toBe(true);
  });

  it('returns false on refusal and on failure', async () => {
    notificationsMock.requestPermissionsAsync.mockResolvedValue({ status: 'denied' });
    expect(await notificationService.requestDeviceAlertPermission()).toBe(false);
    notificationsMock.requestPermissionsAsync.mockRejectedValue(new Error('no runtime'));
    expect(await notificationService.requestDeviceAlertPermission()).toBe(false);
  });
});
