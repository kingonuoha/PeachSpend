import { ScannedReceipt, CategoryKey, GeminiResponse } from '../types/gemini';
import { databaseService } from './DatabaseService';
import { logger } from '../utils/logger';

class GeminiService {
  private baseUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

  async scanReceipt(base64Image: string, mode: 'receipt' | 'product' = 'receipt'): Promise<ScannedReceipt[]> {
    const apiKey = await databaseService.getSetting('gemini_api_key');
    if (!apiKey) {
      throw new Error('Gemini API Key not found in settings');
    }

    const receiptPrompt = `
      You are a high-precision financial OCR assistant. 
      Analyze the provided receipt image. 
      
      FIRST, assess the legibility of the image. If the image is too blurry, too dark, or contains no receipt/financial data, set "legibility" to "poor".
      
      SECOND, extract EVERY INDIVIDUAL ITEM from the receipt. 
      For each item, provide:
      - item_name: (clear and concise name of the product)
      - amount: (numerical price of this specific item)
      - category: (classify into: dining, groceries, transport, shopping, entertainment, health, utilities, other)
      - merchant: (the store name)
      - currency: (3-letter ISO code if found, defaults to "USD")

      Return ONLY a valid JSON object:
      {
        "legibility": "good" | "poor",
        "items": [
          { "merchant": "...", "item_name": "...", "amount": 12.50, "category": "...", "currency": "..." },
          ...
        ]
      }
    `;

    const productPrompt = `
      You are a product identification assistant.
      Identify the product in this image. 
      Return ONLY a valid JSON object with the following keys:
      - legibility: "good"
      - items: [
          {
            "merchant": "Unknown",
            "item_name": "...",
            "amount": 0,
            "category": "...",
            "currency": "USD"
          }
        ]
    `;

    const prompt = mode === 'receipt' ? receiptPrompt : productPrompt;

    try {
      const response = await fetch(`${this.baseUrl}?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                {
                  inline_data: {
                    mime_type: 'image/jpeg',
                    data: base64Image,
                  },
                },
              ],
            },
          ],
        }),
      });

      const data: GeminiResponse = await response.json();
      
      if (data.error) {
        throw new Error(data.error.message || 'Gemini API Error');
      }

      if (!data.candidates || data.candidates.length === 0) {
        throw new Error('Gemini failed to generate a response. Please try again.');
      }

      const text = data.candidates[0].content.parts[0].text;
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('Failed to parse Gemini response');
      
      const parsed = JSON.parse(jsonMatch[0]);
      
      if (parsed.legibility === 'poor') {
        throw new Error('IMAGE_NOT_LEGIBLE');
      }

      const items = parsed.items || [];
      if (items.length === 0) {
        throw new Error('NO_ITEMS_FOUND');
      }

      return items.map((item: any) => ({
        id: Math.random().toString(36).substring(7),
        merchant: item.merchant || 'Unknown Merchant',
        amount: parseFloat(item.amount) || 0,
        category: (item.category as CategoryKey) || 'other',
        note: item.item_name || '',
        currency: item.currency || 'USD',
        date: Math.floor(Date.now() / 1000),
        confidence: 0.9,
      }));
    } catch (error) {
      logger.error('Gemini Scan Error:', error);
      throw error;
    }
  }

  async categorizeExpense(merchant: string, amount: number): Promise<CategoryKey> {
    const lowerMerchant = merchant.toLowerCase();
    if (lowerMerchant.includes('uber') || lowerMerchant.includes('lyft')) return 'transport';
    if (lowerMerchant.includes('starbucks') || lowerMerchant.includes('mcdonald')) return 'dining';
    if (lowerMerchant.includes('walmart') || lowerMerchant.includes('target')) return 'groceries';
    return 'other';
  }
}

export const geminiService = new GeminiService();
