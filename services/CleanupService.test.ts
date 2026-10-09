import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupService } from './CleanupService';

const fileSystem = vi.hoisted(() => ({
  cacheDirectory: 'cache/',
  readDirectoryAsync: vi.fn(),
  deleteAsync: vi.fn(),
}));

vi.mock('expo-file-system/legacy', () => fileSystem);
vi.mock('../utils/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn() },
}));

describe('CleanupService export cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes only PeachSpend export CSV files', async () => {
    fileSystem.readDirectoryAsync.mockResolvedValue([
      'peachspend_private_export_old.csv',
      'unrelated.csv',
      'peachspend_private_export_notes.txt',
    ]);

    await cleanupService.performRoutineCleanup();

    expect(fileSystem.deleteAsync).toHaveBeenCalledTimes(1);
    expect(fileSystem.deleteAsync).toHaveBeenCalledWith(
      'cache/peachspend_private_export_old.csv',
      { idempotent: true },
    );
  });

  it('does nothing when private cache is unavailable', async () => {
    fileSystem.cacheDirectory = null as unknown as string;

    await cleanupService.performRoutineCleanup();

    expect(fileSystem.readDirectoryAsync).not.toHaveBeenCalled();
    expect(fileSystem.deleteAsync).not.toHaveBeenCalled();
    fileSystem.cacheDirectory = 'cache/';
  });
});
