import { logger } from '../utils/logger';
import { cacheDirectory, deleteAsync, readDirectoryAsync } from 'expo-file-system/legacy';

export const PEACHSPEND_EXPORT_PREFIX = 'peachspend_private_export_';

function isStaleExportFile(fileName: string): boolean {
  return fileName.startsWith(PEACHSPEND_EXPORT_PREFIX) && fileName.endsWith('.csv');
}

class CleanupService {
  async performRoutineCleanup() {
    try {
      await this.removeStaleExports();
      logger.info('Cleanup completed.');
    } catch {
      logger.error('Cleanup Service Error', 'cleanup_failed');
    }
  }

  private async removeStaleExports(): Promise<void> {
    if (!cacheDirectory) return;

    const fileNames = await readDirectoryAsync(cacheDirectory);
    const staleExports = fileNames.filter(isStaleExportFile);
    await Promise.all(
      staleExports.map(fileName => deleteAsync(`${cacheDirectory}${fileName}`, { idempotent: true }))
    );
  }
}

export const cleanupService = new CleanupService();
