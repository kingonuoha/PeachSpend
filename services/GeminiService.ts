import { ScannedReceipt, GeminiResponse } from '../types/gemini';
import { databaseService } from './DatabaseService';
import { logger } from '../utils/logger';

const DEFAULT_ICON = 'tag';
const DEFAULT_COLOR = '#94A3B8';

class GeminiService {
  private baseUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

  async scanReceipt(base64Image: string, mode: 'receipt' | 'product' = 'receipt'): Promise<ScannedReceipt[]> {
    const apiKey = await databaseService.getSetting('gemini_api_key');
    if (!apiKey) {
      throw new Error('Gemini API Key not found in settings');
    }

    // Fetch existing categories and build the dynamic list for the prompt
    const categories = await databaseService.getCategories();
    const categoryList = categories.map(c => c.title.toLowerCase()).join(', ');

    const receiptPrompt = `
      You are a high-precision financial OCR assistant. 
      Analyze the provided receipt image. 
      
      FIRST, assess the legibility of the image. If the image is too blurry, too dark, or contains no receipt/financial data, set "legibility" to "poor".
      
      SECOND, extract EVERY INDIVIDUAL ITEM from the receipt. 
      For each item, provide:
      - item_name: (clear and concise name of the product)
      - amount: (numerical price of this specific item)
      - category: (classify into one of: ${categoryList})
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

      // Build a set of existing category IDs for quick lookup
      const existingIds = new Set(categories.map(c => c.id));

      return await Promise.all(items.map(async (item: any) => {
        const category = (item.category || 'other').toLowerCase();

        // Auto-create category if it doesn't exist
        if (!existingIds.has(category)) {
          try {
            const title = category.charAt(0).toUpperCase() + category.slice(1);
            await databaseService.addCategory(title, DEFAULT_ICON, DEFAULT_COLOR);
            existingIds.add(category);
          } catch {
            // Race condition: another call may have created it already — ignore
          }
        }

        return {
          id: Math.random().toString(36).substring(7),
          merchant: item.merchant || 'Unknown Merchant',
          amount: parseFloat(item.amount) || 0,
          category,
          note: item.item_name || '',
          currency: item.currency || 'USD',
          date: Math.floor(Date.now() / 1000),
          confidence: 0.9,
        };
      }));
    } catch (error) {
      logger.error('Gemini Scan Error:', error);
      throw error;
    }
  }

  async generateWeeklyDigest(): Promise<string> {
    const apiKey = await databaseService.getSetting('gemini_api_key');
    if (!apiKey) {
      throw new Error('Gemini API Key not found in settings');
    }

    const sevenDaysAgo = Date.now() - 7 * 86400000;
    const expenses = await databaseService.getExpenses();
    const weeklyExpenses = expenses.filter(e => e.created_at >= sevenDaysAgo);

    if (weeklyExpenses.length === 0) {
      return "You had no recorded expenses in the past week. A clean slate — or maybe something slipped through the cracks?";
    }

    // Aggregate data
    const totalSpend = weeklyExpenses.reduce((sum, e) => sum + e.amount, 0);
    const topCategory = weeklyExpenses.reduce<{ category: string; total: number }[]>((acc, e) => {
      const existing = acc.find(a => a.category === e.category);
      if (existing) existing.total += e.amount;
      else acc.push({ category: e.category, total: e.amount });
      return acc;
    }, []).sort((a, b) => b.total - a.total)[0];

    const biggestExpense = weeklyExpenses.sort((a, b) => b.amount - a.amount)[0];

    // Previous week comparison
    const fourteenDaysAgo = Date.now() - 14 * 86400000;
    const prevWeekExpenses = expenses.filter(e => e.created_at >= fourteenDaysAgo && e.created_at < sevenDaysAgo);
    const prevTotal = prevWeekExpenses.reduce((sum, e) => sum + e.amount, 0);
    const changePercent = prevTotal > 0 ? ((totalSpend - prevTotal) / prevTotal) * 100 : 0;

    const summaryData = `Weekly spending summary for the past 7 days:
- Total spent: $${totalSpend.toFixed(2)}
- Previous week total: $${prevTotal.toFixed(2)}
- Change: ${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(1)}%
- Top category: ${topCategory?.category || 'N/A'} ($${(topCategory?.total || 0).toFixed(2)})
- Biggest expense: ${biggestExpense?.merchant || 'N/A'} ($${(biggestExpense?.amount || 0).toFixed(2)})
- Number of transactions: ${weeklyExpenses.length}`;

    const prompt = `You are a friendly financial coach. Given the following weekly spending summary, write a 2-3 sentence natural language insight. Be encouraging and include one actionable observation. Keep it conversational and under 80 words.

${summaryData}

Return ONLY the text, no JSON, no markdown.`;

    try {
      const response = await fetch(`${this.baseUrl}?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      });

      const data = await response.json();
      if (data.error) throw new Error(data.error.message);
      if (!data.candidates?.length) throw new Error('No response from Gemini');

      return data.candidates[0].content.parts[0].text.trim();
    } catch (error) {
      logger.error('Weekly digest generation failed', error);
      throw error;
    }
  }

  async categorizeExpense(merchant: string, amount: number): Promise<string> {
    const lowerMerchant = merchant.toLowerCase();
    if (lowerMerchant.includes('uber') || lowerMerchant.includes('lyft')) return 'transport';
    if (lowerMerchant.includes('starbucks') || lowerMerchant.includes('mcdonald')) return 'dining';
    if (lowerMerchant.includes('walmart') || lowerMerchant.includes('target')) return 'groceries';
    return 'other';
  }
}

export const geminiService = new GeminiService();
