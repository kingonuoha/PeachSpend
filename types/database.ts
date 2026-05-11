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
