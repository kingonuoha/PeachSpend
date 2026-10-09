import { beforeEach, describe, expect, it, vi } from 'vitest';

const fileSystem = vi.hoisted(() => ({
  cacheDirectory: 'cache/' as string | null,
  documentDirectory: 'doc/' as string | null,
  getInfoAsync: vi.fn(),
  deleteAsync: vi.fn(),
  readDirectoryAsync: vi.fn(),
}));

vi.mock('expo-file-system/legacy', () => fileSystem);

import { ownedMediaErasurePort } from './MediaErasureService';
import { isOwnedReceiptImage, isOwnedReceiptImageName } from '../utils/ownedReceiptImage';
import { isOwnedAvatarFile } from '../utils/profileAvatar';
import { isOwnedExportFileName } from './CleanupService';

beforeEach(() => {
  vi.clearAllMocks();
  fileSystem.cacheDirectory = 'cache/';
});

describe('owned media guards', () => {
  it('recognizes only the app receipt prefix inside the app cache', () => {
    expect(isOwnedReceiptImage('cache/peachspend-receipt-a.jpg')).toBe(true);
    expect(isOwnedReceiptImage('cache/unrelated.jpg')).toBe(false);
    expect(isOwnedReceiptImage('/sdcard/peachspend-receipt-a.jpg')).toBe(false);
    expect(isOwnedReceiptImageName('peachspend-receipt-a.jpg')).toBe(true);
    expect(isOwnedReceiptImageName('xpeachspend-receipt-a.jpg')).toBe(false);
  });

  it('recognizes only app-written avatar names', () => {
    expect(isOwnedAvatarFile('avatar_1700000000000.jpg')).toBe(true);
    expect(isOwnedAvatarFile('avatar_1.png')).toBe(true);
    expect(isOwnedAvatarFile('selfie.jpg')).toBe(false);
    expect(isOwnedAvatarFile('avatar_latest.jpg')).toBe(false);
  });

  it('recognizes only app export CSVs', () => {
    expect(isOwnedExportFileName('peachspend_private_export_1_2.csv')).toBe(true);
    expect(isOwnedExportFileName('peachspend_private_export_1_2.txt')).toBe(false);
    expect(isOwnedExportFileName('report.csv')).toBe(false);
  });
});

describe('ownedMediaErasurePort', () => {
  it('refuses a receipt image the app does not own', async () => {
    await expect(ownedMediaErasurePort.deleteReceiptImage('/sdcard/photo.jpg')).resolves.toBe(false);
    await expect(ownedMediaErasurePort.deleteReceiptImage('cache/unrelated.jpg')).resolves.toBe(false);

    expect(fileSystem.deleteAsync).not.toHaveBeenCalled();
  });

  it('deletes an owned receipt image', async () => {
    await expect(ownedMediaErasurePort.deleteReceiptImage('cache/peachspend-receipt-a.jpg')).resolves.toBe(true);

    expect(fileSystem.deleteAsync).toHaveBeenCalledWith('cache/peachspend-receipt-a.jpg', { idempotent: true });
  });

  it('sweeps only owned receipt images from the cache', async () => {
    fileSystem.readDirectoryAsync.mockResolvedValue([
      'peachspend-receipt-a.jpg',
      'unrelated.jpg',
      'peachspend-receipt-b.png',
    ]);

    await expect(ownedMediaErasurePort.sweepReceiptImages()).resolves.toBe(2);

    expect(fileSystem.deleteAsync).toHaveBeenCalledTimes(2);
    expect(fileSystem.deleteAsync).toHaveBeenCalledWith('cache/peachspend-receipt-a.jpg', { idempotent: true });
    expect(fileSystem.deleteAsync).toHaveBeenCalledWith('cache/peachspend-receipt-b.png', { idempotent: true });
  });

  it('sweeps only owned avatars from the avatar directory', async () => {
    fileSystem.readDirectoryAsync.mockResolvedValue(['avatar_1.jpg', 'notes.txt', 'avatar_2.png']);

    await expect(ownedMediaErasurePort.sweepProfileAvatars()).resolves.toBe(2);

    expect(fileSystem.readDirectoryAsync).toHaveBeenCalledWith('doc/profile_pics/');
    expect(fileSystem.deleteAsync).toHaveBeenCalledWith('doc/profile_pics/avatar_1.jpg', { idempotent: true });
    expect(fileSystem.deleteAsync).toHaveBeenCalledWith('doc/profile_pics/avatar_2.png', { idempotent: true });
  });

  it('sweeps only owned export CSVs', async () => {
    fileSystem.readDirectoryAsync.mockResolvedValue([
      'peachspend_private_export_1_2.csv',
      'report.csv',
      'peachspend_private_export_3_4.txt',
    ]);

    await expect(ownedMediaErasurePort.sweepExportFiles()).resolves.toBe(1);

    expect(fileSystem.deleteAsync).toHaveBeenCalledWith('cache/peachspend_private_export_1_2.csv', { idempotent: true });
  });

  it('is a no-op when the cache or document root is unavailable', async () => {
    fileSystem.cacheDirectory = null;
    fileSystem.documentDirectory = null;

    await expect(ownedMediaErasurePort.sweepReceiptImages()).resolves.toBe(0);
    await expect(ownedMediaErasurePort.sweepProfileAvatars()).resolves.toBe(0);
    await expect(ownedMediaErasurePort.sweepExportFiles()).resolves.toBe(0);

    expect(fileSystem.readDirectoryAsync).not.toHaveBeenCalled();
    expect(fileSystem.deleteAsync).not.toHaveBeenCalled();
  });
});
