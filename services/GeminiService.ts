import { ScannedReceipt, CategoryKey, GeminiResponse } from '../types/gemini';
import { databaseService } from './DatabaseService';
import { logger } from '../utils/logger';

class GeminiService {
  private baseUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';

  async scanReceipt(base64Image: string): Promise<ScannedReceipt> {
    const apiKey = await databaseService.getSetting('gemini_api_key');
    if (!apiKey) {
      throw new Error('Gemini API Key not found in settings');
    }

    const prompt = `
      Extract the following information from this receipt image:
      - Merchant name
      - Total amount
      - Date of transaction (Unix timestamp)
      - Category (must be one of: dining, groceries, transport, shopping, entertainment, health, utilities, other)

      Return the data strictly as a JSON object with keys: merchant, amount, date, category.
    `;

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
      const text = data.candidates[0].content.parts[0].text;
      
      // Basic JSON extraction from markdown if necessary
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('Failed to parse Gemini response as JSON');
      
      const parsed = JSON.parse(jsonMatch[0]);
      
      return {
        merchant: parsed.merchant || 'Unknown Merchant',
        amount: parseFloat(parsed.amount) || 0,
        category: (parsed.category as CategoryKey) || 'other',
        date: parsed.date || Math.floor(Date.now() / 1000),
        confidence: 0.9, // Simplified
      };
    } catch (error) {
      logger.error('Gemini Scan Receipt Error:', error);
      throw error;
    }
  }

  async categorizeExpense(merchant: string, amount: number): Promise<CategoryKey> {
    // Simplified categorization - could be expanded to use Gemini
    const lowerMerchant = merchant.toLowerCase();
    if (lowerMerchant.includes('uber') || lowerMerchant.includes('lyft')) return 'transport';
    if (lowerMerchant.includes('starbucks') || lowerMerchant.includes('mcdonald')) return 'dining';
    if (lowerMerchant.includes('walmart') || lowerMerchant.includes('target')) return 'groceries';
    return 'other';
  }
}

export const geminiService = new GeminiService();
