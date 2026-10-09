import { logger } from '../utils/logger';
import { cacheDirectory, deleteAsync, readDirectoryAsync } from 'expo-file-system/legacy';

export const PEACHSPEND_EXPORT_PREFIX = 'peachspend_private_export_';

// D9 / S-06R-01: one owned-export rule shared by the app-start sweep and the
// Reset App sweep, so Reset cannot delete a file the routine cleanup would keep.
export function isOwnedExportFileName(fileName: string): boolean {
  return fileName.startsWith(PEACHSPEND_EXPORT_PREFIX) && fileName.endsWith('.csv');
}

// D9 / S-06R-01: removes every export CSV the app wrote and returns the real
// count. Reused by the routine cleanup and by Reset App so both share one rule.
export async function sweepOwnedExportFiles(): Promise<number> {
  if (!cacheDirectory) return 0;
  const fileNames = await readDirectoryAsync(cacheDirectory);
  const owned = fileNames.filter(isOwnedExportFileName);
  await Promise.all(
    owned.map(fileName => deleteAsync(`${cacheDirectory}${fileName}`, { idempotent: true }))
  );
  return owned.length;
}

class CleanupService {
  async performRoutineCleanup() {
    try {
      await sweepOwnedExportFiles();
      logger.info('Cleanup completed.');
    } catch {
      logger.error('Cleanup Service Error', 'cleanup_failed');
    }
  }
}

export const cleanupService = new CleanupService();
