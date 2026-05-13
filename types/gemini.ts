export interface ScannedReceipt {
  merchant: string;
  amount: number;
  category: string;
  currency: string;
  date?: number;
  confidence: number;
  note?: string; // For item names
  is_reimbursable?: number; // 0 or 1
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
