// S-16 category ownership (FR-16.1-16.4). These are the only create/edit/read
// boundaries. Deletion stays unsupported and is represented by an explicit
// constant so no screen can imply the removed capability exists.

export interface CategoryRecord {
  id: string;
  title: string;
  iconName: string;
  color: string;
  isDefault: boolean;
}

export interface CategoryRow {
  id: string;
  title: string;
  icon_name: string;
  color: string;
  is_default?: number;
}

export interface CategoryCreateInput {
  title: string;
  iconName: string;
  color: string;
}

export interface CategoryUpdateInput {
  id: string;
  title?: string;
  iconName?: string;
  color?: string;
}

export type CategoryMutationResult =
  | { status: 'saved'; category: CategoryRecord }
  | { status: 'duplicate'; id: string }
  | { status: 'not_found'; id: string }
  | { status: 'invalid'; field: 'title'; reason: 'empty' };

export interface CategoryPort {
  getCategories(): Promise<CategoryRow[]>;
  addCategory(title: string, icon: string, color: string): Promise<string>;
  renameCategory(id: string, newTitle: string): Promise<void>;
  updateCategoryColor(id: string, color: string): Promise<void>;
  updateCategoryIcon(id: string, iconName: string): Promise<void>;
}

export const CATEGORY_DELETION_SUPPORT = {
  supported: false,
  message: 'Category deletion is not yet supported. Deletion support is coming in a future update.',
} as const;

// Shared colour palette for categories created by S-16 and by import
// auto-provisioning, so both paths draw from one list.
export const CATEGORY_COLOR_PALETTE = [
  '#FFD2C4', '#FFAB91', '#81C784', '#CF6679', '#FBBF24', '#60A5FA', '#A78BFA', '#34D399',
  '#F472B6', '#F97316', '#14B8A6', '#94A3B8',
] as const;

export const DEFAULT_CATEGORY_ICON = 'tag';
