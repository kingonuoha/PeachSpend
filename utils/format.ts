export function formatAmount(amount: number): string {
  if (amount < 10000) {
    return amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (amount < 1000000) {
    const val = amount / 1000;
    return val % 1 === 0 ? `${val.toFixed(0)}k` : `${val.toFixed(1)}k`;
  }
  const val = amount / 1000000;
  return val % 1 === 0 ? `${val.toFixed(0)}M` : `${val.toFixed(1)}M`;
}
