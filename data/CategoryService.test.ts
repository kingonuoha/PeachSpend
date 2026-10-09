import { describe, expect, it } from 'vitest';
import { CATEGORY_DELETION_SUPPORT, CATEGORY_COLOR_PALETTE } from './CategoryContracts';
import type { CategoryPort, CategoryRow } from './CategoryContracts';
import { CategoryService, slugifyCategoryTitle } from './CategoryService';

class MemoryCategoryPort implements CategoryPort {
  rows: CategoryRow[] = [];
  addCalls: string[] = [];
  async getCategories(): Promise<CategoryRow[]> { return this.rows; }
  async addCategory(title: string, icon: string, color: string): Promise<string> {
    const id = slugifyCategoryTitle(title);
    this.addCalls.push(id);
    this.rows.push({ id, title, icon_name: icon, color, is_default: 0 });
    return id;
  }
  async renameCategory(id: string, newTitle: string): Promise<void> { this.rows = this.rows.map(row => (row.id === id ? { ...row, title: newTitle } : row)); }
  async updateCategoryColor(id: string, color: string): Promise<void> { this.rows = this.rows.map(row => (row.id === id ? { ...row, color } : row)); }
  async updateCategoryIcon(id: string, iconName: string): Promise<void> { this.rows = this.rows.map(row => (row.id === id ? { ...row, icon_name: iconName } : row)); }
}

describe('category ownership boundaries', () => {
  it('creates through the sole writer and blocks a duplicate slug', async () => {
    const port = new MemoryCategoryPort();
    const service = new CategoryService(port);

    await expect(service.create({ title: 'Coffee', iconName: 'coffee', color: '#111' })).resolves.toMatchObject({ status: 'saved', category: { id: 'coffee' } });
    await expect(service.create({ title: '  coffee  ', iconName: 'coffee', color: '#111' })).resolves.toEqual({ status: 'duplicate', id: 'coffee' });
    expect(port.addCalls).toEqual(['coffee']);
  });

  it('rejects an empty title without writing', async () => {
    const port = new MemoryCategoryPort();
    await expect(new CategoryService(port).create({ title: '   ', iconName: 'tag', color: '#111' })).resolves.toEqual({ status: 'invalid', field: 'title', reason: 'empty' });
    expect(port.addCalls).toEqual([]);
  });

  it('edits an existing category and reports a missing one', async () => {
    const port = new MemoryCategoryPort();
    const service = new CategoryService(port);
    await service.create({ title: 'Coffee', iconName: 'coffee', color: '#111' });

    await expect(service.update({ id: 'coffee', title: 'Cafe', color: '#222' })).resolves.toMatchObject({ status: 'saved', category: { title: 'Cafe', color: '#222' } });
    await expect(service.update({ id: 'missing', title: 'X' })).resolves.toEqual({ status: 'not_found', id: 'missing' });
  });

  it('keeps deletion unsupported and honest', () => {
    expect(CATEGORY_DELETION_SUPPORT.supported).toBe(false);
    expect(CATEGORY_DELETION_SUPPORT.message.length).toBeGreaterThan(0);
  });

  it('provisions import categories through the same writer without duplicates', async () => {
    const port = new MemoryCategoryPort();
    const service = new CategoryService(port);
    await service.create({ title: 'Dining', iconName: 'utensils', color: '#111' });

    const created = await service.ensure(['dining', 'travel', 'travel']);

    expect(created).toEqual(['travel']);
    expect(port.addCalls).toEqual(['dining', 'travel']);
    expect(port.rows.find(row => row.id === 'travel')?.color).toBe(CATEGORY_COLOR_PALETTE[1]);
  });
});
