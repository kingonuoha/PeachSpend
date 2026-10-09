export type ExpenseNotificationEntry = { merchant: string; amount: string };

// Pure visibility interpretation and body construction for expense
// notifications. Kept free of native imports so it is unit testable and so the
// prices_visible rule has exactly one definition, read once by the service.

export function isAmountVisible(settingValue: string | null): boolean {
  return settingValue !== 'false';
}

export async function resolveAmountVisibility(
  readSetting: () => Promise<string | null>
): Promise<boolean> {
  try {
    return isAmountVisible(await readSetting());
  } catch {
    // Fail closed: if the setting cannot be read, never include an amount.
    return false;
  }
}

export function buildExpenseNotificationBody(
  batch: ExpenseNotificationEntry[],
  amountsVisible: boolean
): string {
  return batch
    .map(item => (amountsVisible ? `${item.merchant} - ${item.amount}` : item.merchant))
    .join('\n');
}
