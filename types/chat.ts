export type ChatRole = 'user' | 'assistant' | 'system';
export type ChatMessageType = 'text' | 'expense_confirmation' | 'image' | 'system';
export type ChatProvider = 'gemini' | 'openrouter';
export type IntentClass =
  | 'category_query'
  | 'merchant_query'
  | 'date_range_query'
  | 'recent_expenses'
  | 'forecast'
  | 'log_expense'
  | 'reimbursable'
  | 'budget_check'
  | 'general';

export interface ChatAction {
  action: 'log_expense';
  merchant: string;
  amount: number;
  category: string;
  note?: string | null;
  date?: string;
}

export interface ExpenseConfirmation {
  action: 'expense_logged';
  id: string;
  merchant: string;
  amount: number;
  currency: string;
  category: string;
  date: string;
  created_at: number;
}

export interface StaticSummary {
  totalSpentThisMonth: number;
  monthlyBudget: number;
  budgetUsedPercent: number;
  daysRemaining: number;
  dailySpendRate: number;
  netBalance: number;
  reimbursableOutstanding: number;
  currency: string;
}

export interface DynamicContext {
  intent: IntentClass;
  data: string;
}

export interface OpenRouterModel {
  displayName: string;
  modelString: string;
  isFree: boolean;
  contextLength: number;
}

export interface GeminiModel {
  name: string;
  displayName: string;
  supportedMethods: string[];
}

export interface ProviderModel {
  id: string;
  displayName: string;
  isFree?: boolean;
  contextLength?: number;
}

export const OPENROUTER_MODELS: OpenRouterModel[] = [
  { displayName: 'Claude Sonnet (Anthropic)', modelString: 'anthropic/claude-sonnet-4-5', isFree: false, contextLength: 200000 },
  { displayName: 'GPT-4o (OpenAI)', modelString: 'openai/gpt-4o', isFree: false, contextLength: 128000 },
  { displayName: 'Gemini 2.5 Flash (Google)', modelString: 'google/gemini-2.5-flash', isFree: false, contextLength: 1048576 },
  { displayName: 'Mistral Large', modelString: 'mistral/mistral-large', isFree: false, contextLength: 128000 },
  { displayName: 'Llama 3.3 70B (Meta)', modelString: 'meta-llama/llama-3.3-70b-instruct', isFree: false, contextLength: 128000 },
];

export const VALID_CATEGORY_IDS = [
  'dining', 'groceries', 'transport', 'shopping',
  'entertainment', 'health', 'utilities', 'other',
];
