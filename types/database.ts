export interface Expense {
  id: string;
  merchant: string;
  amount: number;
  currency: string;
  category: string;
  note?: string;
  scanned: number; // 0 or 1
  date: number; // Unix timestamp
  created_at: number; // Unix timestamp
  image_uri?: string; // Local file URI for attached receipt image
  is_reimbursable?: number; // 0 or 1
  is_recurring?: number; // 0 or 1
  recurrence_interval?: string; // daily, weekly, monthly, custom
  recurrence_days?: string; // JSON array e.g. [1,2,3,4,5]
  next_due_date?: number; // Unix timestamp
  recurrence_parent_id?: string; // UUID of recurring template
}

export interface Category {
  id: string; // key e.g. 'dining'
  title: string;
  icon_name: string;
  color: string;
}

export interface Setting {
  key: string;
  value: string;
}

export interface RecurringTemplate {
  id: string;
  merchant: string;
  amount: number;
  currency: string;
  category: string;
  note?: string;
  interval: string; // daily, weekly, monthly, custom
  recurrence_days?: string; // JSON array
  next_due_date: number;
  type: string; // 'expense' | 'income'
  created_at: number;
}

export type CategoryKey = 
  | 'dining' 
  | 'groceries' 
  | 'transport' 
  | 'shopping' 
  | 'entertainment' 
  | 'health' 
  | 'utilities' 
  | 'other';
