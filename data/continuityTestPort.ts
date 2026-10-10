// In-memory ContinuityImportPort for the continuity tests. Test double only: no
// application module imports it, so it never reaches a bundle.
import type { ContinuityImportPort, ContinuityRowMatch } from './ContinuityContracts';

const sameRow = (a: ContinuityRowMatch, b: ContinuityRowMatch): boolean =>
  a.merchant === b.merchant &&
  a.amount === b.amount &&
  a.currency === b.currency &&
  a.category === b.category &&
  a.note === b.note &&
  a.scanned === b.scanned &&
  a.date === b.date;

export class MemoryContinuityPort implements ContinuityImportPort {
  rows: ContinuityRowMatch[] = [];
  categories: string[] = [];
  failSaves = false;

  async ensureCategories(names: string[]): Promise<void> {
    this.categories.push(...names);
  }

  async countExisting(match: ContinuityRowMatch): Promise<number> {
    return this.rows.filter(row => sameRow(row, match)).length;
  }

  async saveRow(match: ContinuityRowMatch): Promise<void> {
    if (this.failSaves) throw new Error('save_failed');
    this.rows.push({ ...match });
  }

  async withTransaction<T>(operation: () => Promise<T>): Promise<T> {
    const snapshot = this.rows.map(row => ({ ...row }));
    try {
      return await operation();
    } catch (error) {
      this.rows = snapshot;
      throw error;
    }
  }
}
