const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  NGN: '₦',
  CAD: '$',
  AUD: '$',
};

// Display names for the currencies the app supports. Reference data, single
// source shared by pickers and settings so no screen hardcodes a name list.
const CURRENCY_NAMES: Record<string, string> = {
  USD: 'US Dollar',
  EUR: 'Euro',
  GBP: 'British Pound',
  JPY: 'Japanese Yen',
  NGN: 'Nigerian Naira',
  CAD: 'Canadian Dollar',
  AUD: 'Australian Dollar',
};

export const DEFAULT_CURRENCY = 'NGN';

export function normalizeCurrency(currency?: string | null): string | null {
  const normalized = currency?.trim().toUpperCase();
  return normalized || null;
}

export function resolveCurrency(recordCurrency?: string | null, userCurrency?: string | null): string {
  return normalizeCurrency(recordCurrency) ?? normalizeCurrency(userCurrency) ?? DEFAULT_CURRENCY;
}

export function resolveUserCurrency(userCurrency?: string | null): string {
  return normalizeCurrency(userCurrency) ?? DEFAULT_CURRENCY;
}

export function resolveDisplayCurrency(userCurrency?: string | null, recordCurrency?: string | null): string {
  return normalizeCurrency(userCurrency) ?? normalizeCurrency(recordCurrency) ?? DEFAULT_CURRENCY;
}

export function formatCurrency(amount: number, currency?: string | null, fallbackCurrency?: string | null): string {
  const value = Number.isFinite(amount) ? amount.toFixed(2) : '--';
  const resolved = resolveCurrency(currency, fallbackCurrency);
  const prefix = getCurrencyPrefix(resolved);

  return CURRENCY_SYMBOLS[resolved]
    ? `${prefix}${value}`
    : `${prefix} ${value}`;
}

export function getCurrencyPrefix(currency?: string | null, fallbackCurrency?: string | null): string {
  const code = resolveCurrency(currency, fallbackCurrency);
  return CURRENCY_SYMBOLS[code] ?? (code || 'UNKNOWN');
}

export function getCurrencyName(currency?: string | null): string {
  const code = normalizeCurrency(currency);
  if (!code) return '';
  return CURRENCY_NAMES[code] ?? code;
}
