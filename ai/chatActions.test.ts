import { describe, expect, it } from 'vitest';
import { chatActionTier, describeTier2Approval, TIER3_DEEP_LINK } from './chatActions';

describe('chat action tiers', () => {
  it('maps each action kind to its fixed tier', () => {
    expect(chatActionTier('log_expense')).toBe(1);
    expect(chatActionTier('log_expenses_bulk')).toBe(2);
    expect(chatActionTier('update_budget')).toBe(2);
    expect(chatActionTier('clear_all_data')).toBe(3);
    expect(chatActionTier('reset_app')).toBe(3);
    expect(chatActionTier('biometric_toggle')).toBe(3);
    expect(chatActionTier('bulk_currency_conversion')).toBe(3);
    expect(chatActionTier('delete_account_data')).toBe(3);
  });

  it('describes a Tier 2 approval without writing anything', () => {
    expect(describeTier2Approval({ kind: 'log_expenses_bulk', items: [] })).toEqual({ kind: 'log_expenses_bulk', summary: 'Log 0 expenses' });
    expect(describeTier2Approval({ kind: 'update_budget', amount: 500 })).toEqual({ kind: 'update_budget', summary: 'Set the monthly budget to 500' });
  });

  it('exposes the S-06 deep link for Tier 3 instead of executing', () => {
    expect(TIER3_DEEP_LINK).toEqual({ screen: 'S-06', section: 'data_stewardship' });
  });
});
