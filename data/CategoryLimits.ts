// Phase 11 D3. Category spending limits, stored in the settings table under
// `category_limit_{categoryId}` with a plain numeric string value in the app
// currency. A categories column was considered and rejected: the category table
// describes what a category is (title, icon, colour, default flag), while a limit
// is a user preference, and the settings table is where preferences already live.

export const CATEGORY_LIMIT_KEY_PREFIX = 'category_limit_';

// The write side of the settings table, satisfied structurally by DatabaseService.
export interface CategoryLimitPort {
  getSetting(key: string): Promise<string | null>;
  getAllSettings(): Promise<Record<string, string>>;
  updateSetting(key: string, value: string): Promise<void>;
  deleteSetting(key: string): Promise<void>;
}

export type CategoryLimitValidation =
  | { status: 'valid'; amount: number }
  | { status: 'invalid'; reason: 'not_finite' | 'negative' }
  | { status: 'cleared'; amount: 0 };

export function categoryLimitKey(categoryId: string): string {
  const trimmed = categoryId.trim();
  if (!trimmed) throw new CategoryLimitError('category');
  return `${CATEGORY_LIMIT_KEY_PREFIX}${trimmed}`;
}

export class CategoryLimitError extends Error {
  readonly code = 'category_limit_invalid';
  constructor(readonly field: 'category' | 'amount') {
    super(`Category limit field is required or invalid: ${field}`);
    this.name = 'CategoryLimitError';
  }
}

// A stored limit reads back as a positive amount or as no limit at all. A zero, a
// negative, a non-numeric or an unreadable string is not a limit of zero: it means
// the key should not have been written, so the reader reports no limit instead of
// rendering "0 spent of 0" against a limit the user never set.
export function parseCategoryLimit(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const amount = Number(trimmed);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return amount;
}

// Zero means cleared rather than a limit of zero, so this is the one place that
// decision is made and the caller never has to special case it.
export function validateCategoryLimitAmount(amount: number): CategoryLimitValidation {
  if (!Number.isFinite(amount)) return { status: 'invalid', reason: 'not_finite' };
  if (amount < 0) return { status: 'invalid', reason: 'negative' };
  if (amount === 0) return { status: 'cleared', amount: 0 };
  return { status: 'valid', amount };
}

// The stored string form. Plain digits and a decimal point only, never a currency
// symbol or a thousands separator, so the value cannot be read back as a different
// amount by a strict parser.
export function formatCategoryLimit(amount: number): string {
  return String(Number(amount.toFixed(2))).trim();
}

export function extractCategoryIdFromLimitKey(key: string): string | null {
  if (!key.startsWith(CATEGORY_LIMIT_KEY_PREFIX)) return null;
  const categoryId = key.slice(CATEGORY_LIMIT_KEY_PREFIX.length).trim();
  return categoryId || null;
}

export class CategoryLimitService {
  constructor(private readonly port: CategoryLimitPort) {}

  async getCategoryLimit(categoryId: string): Promise<number | null> {
    return parseCategoryLimit(await this.port.getSetting(categoryLimitKey(categoryId)));
  }

  async setCategoryLimit(categoryId: string, amount: number): Promise<void> {
    const key = categoryLimitKey(categoryId);
    const validation = validateCategoryLimitAmount(amount);
    if (validation.status === 'invalid') throw new CategoryLimitError('amount');
    if (validation.status === 'cleared') {
      await this.port.deleteSetting(key);
      return;
    }
    await this.port.updateSetting(key, formatCategoryLimit(validation.amount));
  }

  // A real delete of the key rather than a sentinel value, so a cleared limit is
  // indistinguishable from one that was never set.
  async clearCategoryLimit(categoryId: string): Promise<void> {
    await this.port.deleteSetting(categoryLimitKey(categoryId));
  }

  // One pass over the settings map, so a category list renders its limits without
  // one query per card.
  async getAllCategoryLimits(): Promise<Record<string, number>> {
    const settings = await this.port.getAllSettings();
    const limits: Record<string, number> = {};
    for (const [key, value] of Object.entries(settings)) {
      const categoryId = extractCategoryIdFromLimitKey(key);
      if (!categoryId) continue;
      const amount = parseCategoryLimit(value);
      if (amount !== null) limits[categoryId] = amount;
    }
    return limits;
  }
}
