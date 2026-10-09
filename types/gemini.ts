export interface ScannedReceipt {
  merchant: string;
  amount: number;
  category: string;
  currency: string;
  date?: number;
  // Provider-reported OCR confidence in (0, 1]. Undefined when the provider did
  // not supply one, so the UI never presents a fabricated certainty.
  confidence?: number;
  note?: string; // For item names
  is_reimbursable?: number; // 0 or 1
  unit_price?: number;
  units?: number;
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
