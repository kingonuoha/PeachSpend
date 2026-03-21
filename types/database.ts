export interface Expense {
  id: string;
  merchant: string;
  amount: number;
  category: string;
  note?: string;
  scanned: number; // 0 or 1
  date: number; // Unix timestamp
  created_at: number; // Unix timestamp
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

export type CategoryKey = 
  | 'dining' 
  | 'groceries' 
  | 'transport' 
  | 'shopping' 
  | 'entertainment' 
  | 'health' 
  | 'utilities' 
  | 'other';
