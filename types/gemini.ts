import { CategoryKey } from './database';
export { CategoryKey };

export interface ScannedReceipt {
  merchant: string;
  amount: number;
  category: CategoryKey;
  currency: string;
  date?: number;
  confidence: number;
  note?: string; // For item names
}

export interface GeminiResponse {
  candidates: {
    content: {
      parts: {
        text: string;
      }[];
    };
  }[];
  error?: {
    message: string;
    code: number;
    status: string;
  };
}
