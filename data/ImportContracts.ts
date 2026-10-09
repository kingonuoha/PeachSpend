import type { Expense } from '../types/database';
import type { ChatActionTier } from '../ai/chatActions';
import type { CaptureCandidate, DuplicateMatch } from './contracts';

export type ImportMethod = 'csv' | 'paste' | 'ai_in_app' | 'ai_external';

export type ImportItemError = 'merchant' | 'amount' | 'currency' | 'category';

// FR-12.3 editable preview item. `included` is the commit gate: only included
// items are written, and a flagged duplicate starts excluded until the user
// explicitly includes it (FR-12.4).
export interface ImportPreviewItem {
  id: string;
  expense: Partial<Expense>;
  candidate: CaptureCandidate | null;
  duplicate: DuplicateMatch | null;
  included: boolean;
  error: ImportItemError | null;
}

export interface ImportParseResult {
  expenses: Partial<Expense>[];
  errors: string[];
}

export interface ImportCommitResult {
  status: 'committed';
  imported: number;
  skipped: number;
  failed: number;
  errors: string[];
}

export interface ImportDataSource {
  parseImportData(input: string): ImportParseResult;
}

// Parse outcome for the S-12 paste/upload and S-07 return path. `empty` means
// the input held no row at all; `failed` carries the parser's own messages.
export type ImportParseState =
  | { status: 'empty'; errors: [] }
  | { status: 'parsed'; items: ImportPreviewItem[]; errors: string[] }
  | { status: 'failed'; errors: string[] };

// FR-12.1 external fallback prompt, kept in the data layer so the rebuilt screen
// and the copy step share one source instead of a screen-local constant.
export const EXTERNAL_IMPORT_PROMPT = `I need to import expense data into the PeachSpend expense tracker app. Convert my expense information below into a JSON array following this exact schema:

{
  "merchant": "string (required): store or vendor name",
  "amount": "number (required): total amount spent, numbers only, no symbols or commas",
  "currency": "string (optional): 3-letter currency code such as USD, EUR, or GBP",
  "category": "string (required): exactly one of: dining, groceries, transport, shopping, entertainment, health, utilities, other",
  "note": "string (optional): notes or description",
  "date": "string (optional, format YYYY-MM-DD): date of the expense",
  "is_reimbursable": "number (optional, default 0): 1 if reimbursable by someone",
  "scanned": "number (optional, default 0): 1 if scanned from a receipt"
}

CRITICAL RULES:
- Respond with ONLY the raw JSON array. No markdown. No code fences. No explanations. No extra text before or after.
- The JSON must be valid and parseable: double-check commas and brackets.
- Every expense MUST include merchant and amount.
- category must be one of the 8 values listed above. Choose the best match.
- amount must be a positive number.
- Convert all dates to YYYY-MM-DD format. Use today if unknown.
- Include ALL items given: do not skip any.

=== YOUR EXPENSE DETAILS ===
Paste or type your expense info below this line, then send this entire message to the AI.`;

// FR-12.1 in-app vs external decision. The in-app path is the default and runs
// through chat with import intent pre-loaded at Tier 2. Offline or missing key
// degrades to the always-available external prompt instead of a dead end.
export type ImportAiAvailability =
  | { status: 'in_app'; feature: 'chat'; intent: 'import'; tier: ChatActionTier; prompt: string }
  | { status: 'external'; reason: 'offline' | 'missing_key'; prompt: string };
