import { normalizeCurrency } from '../utils/currency';
import { parseCurrencyRateMap, type CurrencyRateMap } from './contracts';

// Single normalization layer for summing amounts that may be stored in different
// currencies. Both capture display totals and Home period totals route through
// here so there is one documented conversion rule, not one per screen.
//
// Rate semantics match the stored conversion_rates map: each value is the worth
// of one unit of that currency in a common base (for example USD = 1). Converting
// from a source to the target is `amount * rate[source] / rate[target]`. A missing
// or non-positive rate excludes the amount and is reported in `missingRates`
// rather than being silently counted at par, which is how a wrong total hides.

export interface CurrencyAmount {
  amount: number;
  currency?: string | null;
}

export interface NormalizedCurrencyTotal {
  total: number;
  currency: string;
  // Currencies excluded from `total` because no positive rate exists for them or
  // for the target. Empty when every entry was convertible.
  missingRates: string[];
  complete: boolean;
}

function sanitizeRateMap(rates: CurrencyRateMap | string | null | undefined): CurrencyRateMap {
  if (typeof rates === 'string' || rates == null) return parseCurrencyRateMap(rates);
  return parseCurrencyRateMap(JSON.stringify(rates));
}

export function normalizeCurrencyTotal(
  entries: CurrencyAmount[],
  targetCurrency: string | null | undefined,
  rates: CurrencyRateMap | string | null | undefined,
): NormalizedCurrencyTotal {
  const target = normalizeCurrency(targetCurrency) ?? '';
  const map = sanitizeRateMap(rates);
  let total = 0;
  const missingRates: string[] = [];
  for (const entry of entries) {
    if (!Number.isFinite(entry.amount)) continue;
    const code = normalizeCurrency(entry.currency) ?? target;
    if (code === target) {
      total += entry.amount;
      continue;
    }
    const sourceRate = map[code];
    const targetRate = map[target];
    if (!sourceRate || !targetRate) {
      if (code && !missingRates.includes(code)) missingRates.push(code);
      continue;
    }
    total += entry.amount * sourceRate / targetRate;
  }
  return { total, currency: target, missingRates, complete: missingRates.length === 0 };
}
