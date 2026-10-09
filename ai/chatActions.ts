import type { BatchSaveResolution, DuplicateMatch, SaveResolution } from '../data/contracts';
import type { Expense } from '../types/database';
import type { ChatAction } from '../types/chat';

// FR-07.12 tiered chat actions. Tier is fixed by the action kind, so the
// executor can hard-block before any write instead of relying on prompt wording.
export type ChatActionTier = 1 | 2 | 3;

export type ChatActionKind =
  | 'log_expense'
  | 'log_expenses_bulk'
  | 'update_budget'
  | 'update_currency'
  | 'update_category_color'
  | 'clear_all_data'
  | 'reset_app'
  | 'biometric_toggle'
  | 'bulk_currency_conversion'
  | 'delete_account_data';

const TIER_BY_KIND: Record<ChatActionKind, ChatActionTier> = {
  log_expense: 1,
  log_expenses_bulk: 2,
  update_budget: 2,
  update_currency: 2,
  update_category_color: 2,
  clear_all_data: 3,
  reset_app: 3,
  biometric_toggle: 3,
  bulk_currency_conversion: 3,
  delete_account_data: 3,
};

export function chatActionTier(kind: ChatActionKind): ChatActionTier {
  return TIER_BY_KIND[kind];
}

// Tier 3 never executes from chat. The executor returns this deep link instead,
// routing the user to the real destructive-action surface (S-06 Data
// Stewardship) that owns the confirmation.
export interface ChatDeepLink {
  screen: 'S-06';
  section: 'data_stewardship';
}

export const TIER3_DEEP_LINK: ChatDeepLink = { screen: 'S-06', section: 'data_stewardship' };

// Tier 2 approval card. `written` is always false, so the "nothing is written
// before approval" guarantee is visible in the value the screen renders.
export interface ChatTier2Approval {
  kind: ChatActionKind;
  summary: string;
}

export type ChatDuplicateAction = 'save_anyway' | 'discard';

// `request` asks for approval (or confirms a Tier 1 save), `approve` executes an
// approved Tier 2 action, `save_anyway` resolves a duplicate, `discard` drops it.
export type ChatApprovalDecision = 'request' | 'approve' | 'save_anyway' | 'discard';

// S-05R-03: authorization is a property of the result, not of the tier. A
// model-emitted action is only authorized when the current user message itself
// reads as a logging request; ledger or receipt text is data, never instruction.
export type ChatActionOutcome =
  | { status: 'saved'; tier: 1; expenseId: string; resolution: SaveResolution<Expense> }
  | { status: 'duplicate'; tier: 1; duplicate: DuplicateMatch; resolution: SaveResolution<Expense>; actions: ChatDuplicateAction[] }
  | { status: 'discarded'; tier: 1 | 2 }
  | { status: 'not_authorized'; tier: 1 | 2 }
  | { status: 'requires_approval'; tier: 2; approval: ChatTier2Approval; written: false }
  | { status: 'batch_saved'; tier: 2; expenseIds: string[]; resolution: BatchSaveResolution }
  | { status: 'batch_needs_review'; tier: 2; resolution: BatchSaveResolution }
  | { status: 'settings_applied'; tier: 2; kind: ChatActionKind }
  | { status: 'unsupported'; tier: 2; kind: ChatActionKind }
  | { status: 'blocked'; tier: 3; deepLink: ChatDeepLink };

export type ChatActionResult = ChatActionOutcome & { actionAuthorized: boolean };

export type ChatActionRequest =
  | { kind: 'log_expense'; action: ChatAction }
  | { kind: 'log_expenses_bulk'; items: ChatAction[] }
  | { kind: 'update_budget'; amount: number }
  | { kind: 'update_currency'; currency: string }
  | { kind: 'update_category_color'; category: string; color: string }
  | { kind: 'clear_all_data' }
  | { kind: 'reset_app' }
  | { kind: 'biometric_toggle' }
  | { kind: 'bulk_currency_conversion' }
  | { kind: 'delete_account_data' };

export function describeTier2Approval(request: ChatActionRequest): ChatTier2Approval {
  switch (request.kind) {
    case 'log_expenses_bulk': return { kind: request.kind, summary: `Log ${request.items.length} expense${request.items.length === 1 ? '' : 's'}` };
    case 'update_budget': return { kind: request.kind, summary: `Set the monthly budget to ${request.amount}` };
    case 'update_currency': return { kind: request.kind, summary: `Set the default currency to ${request.currency}` };
    case 'update_category_color': return { kind: request.kind, summary: `Change the ${request.category} category color` };
    default: return { kind: request.kind, summary: request.kind };
  }
}
