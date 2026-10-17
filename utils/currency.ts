// One money formatter for the whole app. Every amount a person or the model
// reads goes through this module, so thousands grouping, the decimal rule and
// the currency symbol can never drift between screens, AI prompt text and
// notification bodies (DEC-B09, DEC-B10, DEC-B13, DEC-B15).

interface CurrencyFormat {
  symbol: string;
  // Where the symbol sits relative to the number. Read from this table, so the
  // formatter never assumes a prefix (DEC-B15).
  position: 'prefix' | 'suffix';
}

const CURRENCY_FORMATS: Record<string, CurrencyFormat> = {
  USD: { symbol: '$', position: 'prefix' },
  EUR: { symbol: '€', position: 'prefix' },
  GBP: { symbol: '£', position: 'prefix' },
  JPY: { symbol: '¥', position: 'prefix' },
  NGN: { symbol: '₦', position: 'prefix' },
  CAD: { symbol: '$', position: 'prefix' },
  AUD: { symbol: '$', position: 'prefix' },
  // Suffix-placement reference so position is genuinely data rather than an
  // assumed prefix. Not offered by any picker, so it never reaches a selector.
  SEK: { symbol: 'kr', position: 'suffix' },
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

// The grouping locale is pinned so a money value reads the same on every device
// and in every test, matching the comma grouping the locked S-02 and S-03 pairs
// use (DEC-B09).
const MONEY_GROUP_LOCALE = 'en-US';

const COMPACT_THRESHOLD = 10000;
const MILLION_THRESHOLD = 1000000;

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

// The one number rule. Whole amounts drop their ".00" (DEC-B13); any other
// amount keeps exactly two decimals, matching the locked pairs. Thousands are
// always grouped (DEC-B09). Exported so a screen that styles the symbol
// separately still renders its number through the same rule.
export function formatMoneyNumber(amount: number): string {
  if (!Number.isFinite(amount)) return '--';
  const whole = Number.isInteger(amount);
  return amount.toLocaleString(MONEY_GROUP_LOCALE, {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  });
}

// Compact form for the two width-bounded sites only (DEC-B14): below 10,000 the
// grouped value, at or above it the 12.5k / 1.2M form.
function formatCompactMoneyNumber(amount: number): string {
  if (!Number.isFinite(amount)) return '--';
  const magnitude = Math.abs(amount);
  if (magnitude < COMPACT_THRESHOLD) return formatMoneyNumber(amount);
  if (magnitude < MILLION_THRESHOLD) {
    const value = amount / 1000;
    return value % 1 === 0 ? `${value.toFixed(0)}k` : `${value.toFixed(1)}k`;
  }
  const value = amount / 1000000;
  return value % 1 === 0 ? `${value.toFixed(0)}M` : `${value.toFixed(1)}M`;
}

// Places the symbol according to the currency's own format, so neither the
// symbol nor its position is assumed. An unknown code falls back to the code
// itself, spaced, which is how the formatter already behaved.
function placeCurrency(number: string, currency: string): string {
  const format = CURRENCY_FORMATS[currency];
  if (!format) return `${currency || 'UNKNOWN'} ${number}`;
  return format.position === 'suffix' ? `${number} ${format.symbol}` : `${format.symbol}${number}`;
}

// A negative amount keeps its minus outside the symbol, which is how the locked
// pairs render "-$64.20".
function withSign(amount: number, body: string): string {
  return Number.isFinite(amount) && amount < 0 ? `-${body}` : body;
}

export function formatCurrency(amount: number, currency?: string | null, fallbackCurrency?: string | null): string {
  const resolved = resolveCurrency(currency, fallbackCurrency);
  return withSign(amount, placeCurrency(formatMoneyNumber(Math.abs(amount)), resolved));
}

// Compact variant of the one formatter, for the two approved sites only.
export function formatCompactCurrency(amount: number, currency?: string | null, fallbackCurrency?: string | null): string {
  const resolved = resolveCurrency(currency, fallbackCurrency);
  return withSign(amount, placeCurrency(formatCompactMoneyNumber(Math.abs(amount)), resolved));
}

export function getCurrencyPrefix(currency?: string | null, fallbackCurrency?: string | null): string {
  const code = resolveCurrency(currency, fallbackCurrency);
  return CURRENCY_FORMATS[code]?.symbol ?? (code || 'UNKNOWN');
}

export function getCurrencyName(currency?: string | null): string {
  const code = normalizeCurrency(currency);
  if (!code) return '';
  return CURRENCY_NAMES[code] ?? code;
}
