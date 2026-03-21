import { CategoryKey } from './database';
export { CategoryKey };

export interface ScannedReceipt {
  merchant: string;
  amount: number;
  category: CategoryKey;
  date?: number;
  confidence: number;
}

export interface GeminiResponse {
  candidates: {
    content: {
      parts: {
        text: string;
      }[];
    };
  }[];
}
