import {
  CATEGORY_COLOR_PALETTE, CATEGORY_DELETION_SUPPORT, DEFAULT_CATEGORY_ICON,
} from './CategoryContracts';
import type {
  CategoryCreateInput, CategoryMutationResult, CategoryPort, CategoryRecord, CategoryUpdateInput,
} from './CategoryContracts';

export function slugifyCategoryTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, '-');
}

export function toCategoryRecord(row: { id: string; title: string; icon_name: string; color: string; is_default?: number }): CategoryRecord {
  return { id: row.id, title: row.title, iconName: row.icon_name, color: row.color, isDefault: row.is_default === 1 };
}

// The sole category writer (FR-16.2). Every create/edit path, including the
// data-layer import auto-provisioning, goes through this class so no second
// writer and no divergent slug rule can exist.
export class CategoryService {
  constructor(private readonly port: CategoryPort) {}

  async list(): Promise<CategoryRecord[]> {
    const rows = await this.port.getCategories();
    return rows.map(toCategoryRecord);
  }

  async create(input: CategoryCreateInput): Promise<CategoryMutationResult> {
    const title = input.title.trim();
    if (!title) return { status: 'invalid', field: 'title', reason: 'empty' };
    const id = slugifyCategoryTitle(title);
    const existing = await this.port.getCategories();
    if (existing.some(category => category.id === id)) return { status: 'duplicate', id };
    const createdId = await this.port.addCategory(title, input.iconName, input.color);
    return { status: 'saved', category: { id: createdId, title, iconName: input.iconName, color: input.color, isDefault: false } };
  }

  async update(input: CategoryUpdateInput): Promise<CategoryMutationResult> {
    const existing = await this.port.getCategories();
    const current = existing.find(category => category.id === input.id);
    if (!current) return { status: 'not_found', id: input.id };
    const title = input.title?.trim() ?? current.title;
    if (!title) return { status: 'invalid', field: 'title', reason: 'empty' };
    const nextTitle = input.title !== undefined ? title : current.title;
    if (nextTitle !== current.title) await this.port.renameCategory(input.id, nextTitle);
    if (input.color !== undefined && input.color !== current.color) await this.port.updateCategoryColor(input.id, input.color);
    if (input.iconName !== undefined && input.iconName !== current.icon_name) await this.port.updateCategoryIcon(input.id, input.iconName);
    return {
      status: 'saved',
      category: {
        id: input.id,
        title: nextTitle,
        iconName: input.iconName ?? current.icon_name,
        color: input.color ?? current.color,
        isDefault: current.is_default === 1,
      },
    };
  }

  // Import provisioning (FR-16.2, FR-12.2): missing category names are created
  // through the same writer so a CSV cannot introduce a category the S-16 rules
  // would reject. Existing names are left untouched and no duplicate is created.
  async ensure(names: string[]): Promise<string[]> {
    const existing = await this.port.getCategories();
    const known = new Set(existing.map(category => category.id));
    const created: string[] = [];
    let colorIndex = existing.length;
    for (const name of names) {
      const title = name.trim();
      if (!title) continue;
      const id = slugifyCategoryTitle(title);
      if (known.has(id)) continue;
      const color = CATEGORY_COLOR_PALETTE[colorIndex % CATEGORY_COLOR_PALETTE.length];
      const humanTitle = title.charAt(0).toUpperCase() + title.slice(1);
      const createdId = await this.port.addCategory(humanTitle, DEFAULT_CATEGORY_ICON, color);
      known.add(createdId);
      created.push(createdId);
      colorIndex += 1;
    }
    return created;
  }
}

export { CATEGORY_DELETION_SUPPORT };
