import { ScannedReceipt } from '../types/gemini';
import { databaseService } from './DatabaseService';
import { logger } from '../utils/logger';
import { geminiClient } from '../ai/providerClients';
import { AiError, normalizeAiError } from '../ai/contracts';
import { parseReceiptResponse } from '../ai/parsing';
import { formatCurrency, resolveDisplayCurrency } from '../utils/currency';

class GeminiService {
  async scanReceipt(base64Image: string, mode: 'receipt' | 'product' = 'receipt', options: { signal?: AbortSignal } = {}): Promise<ScannedReceipt[]> {
    const apiKey = await databaseService.getSecret('gemini_api_key');
    if (!apiKey) throw new AiError('missing_key', 'gemini', 'AI provider key is not configured');

    // Fetch existing categories and build the dynamic list for the prompt
    const categories = await databaseService.getCategories();
    const categoryList = categories.map(c => c.title.toLowerCase()).join(', ');

    const receiptPrompt = `
      You are a high-precision financial OCR assistant. 
      Analyze the provided receipt image. 
      
      FIRST, assess the legibility of the image. If the image is too blurry, too dark, or contains no receipt/financial data, set "legibility" to "poor".
      
      SECOND, extract EVERY INDIVIDUAL ITEM from the receipt. Be precise with numbers.
      For each item, provide:
      - item_name: (clear and concise name of the product)
      - amount: (the TOTAL line price for this item, e.g. "2 x $3.50" should be amount=7.00)
      - unit_price: (the price per single unit, e.g. "2 x $3.50" has unit_price=3.50; if only a single price, set unit_price equal to amount)
      - units: (the quantity purchased; "2 x $3.50" has units=2; if single item without quantity, units=1)
      - category: (classify into one of: ${categoryList})
      - merchant: (the store name)
      - currency: (3-letter ISO code found on receipt; omit item if unavailable)
      - confidence: (your certainty for this item as a number from 0 to 1, where 1 is fully certain; omit this key entirely if you cannot estimate it)

      IMPORTANT: amount MUST equal unit_price * units. Double-check your math.
       Every item must include merchant, amount greater than zero, category, and currency. Do not guess missing values. Omit items with missing required data.
       Return ONLY a valid JSON object:
      {
        "legibility": "good" | "poor",
        "items": [
          { "merchant": "...", "item_name": "...", "amount": 7.00, "unit_price": 3.50, "units": 2, "category": "...", "currency": "...", "confidence": 0.95 },
          ...
        ]
      }
    `;

    const productPrompt = `
      You are a product identification assistant.
      Identify the product in this image. 
       Return ONLY a valid JSON object with the following keys:
       - legibility: "good" or "poor"
       - items: [
           {
             "merchant": "store name found in image",
             "item_name": "product name found in image",
             "amount": "price found in image",
             "category": "category from configured list",
             "currency": "currency code found in image",
             "confidence": "certainty for this item, number from 0 to 1; omit if unavailable"
           }
         ]
       Do not invent values. Return legibility "poor" when any required value is not visible.
    `;

    const prompt = mode === 'receipt' ? receiptPrompt : productPrompt;

    try {
      const response = await geminiClient.generate({ feature: 'receipt_ocr', prompt, imageBase64: base64Image, model: 'gemini-2.5-flash', signal: options.signal }, apiKey);
      const parsed = parseReceiptResponse(response.text);
       if (parsed.legibility === 'poor') throw new AiError('illegible_image', 'gemini', 'Receipt image could not be read');
       const items = parsed.items;

      // Resolve the model's category text to an existing category id only. OCR
      // must not create categories or write anything before the user confirms in
      // SH-04a (FR-04.1). An unknown value falls back to the default "other" id,
      // and a build with no categories keeps the raw text so the sheet shows the
      // category as unset instead of persisting a guess.
      const categoryById = new Map(categories.map(category => [category.id.toLowerCase(), category.id]));
      const categoryByTitle = new Map(categories.map(category => [category.title.toLowerCase(), category.id]));
      const fallbackCategory = categoryById.has('other') ? categoryById.get('other')! : null;
      const resolveCategoryId = (raw: string): string => {
        const key = raw.trim().toLowerCase();
        return categoryById.get(key) ?? categoryByTitle.get(key) ?? fallbackCategory ?? key;
      };

      return items.map((item) => {
        const unitPrice = item.unitPrice ?? item.amount;
        const units = item.units ?? 1;

        return {
          id: Math.random().toString(36).substring(7),
           merchant: item.merchant,
          amount: unitPrice * units,
          unit_price: unitPrice,
          units,
          category: resolveCategoryId(item.category),
          note: item.note || '',
          currency: item.currency,
          date: Date.now(),
          confidence: item.confidence,
        };
      });
    } catch (error) {
      const normalized = normalizeAiError(error, 'gemini');
      logger.error('Gemini scan failed', normalized.code);
      throw normalized;
    }
  }

  async generateWeeklyDigest(): Promise<string> {
    try {
      const apiKey = await databaseService.getSecret('gemini_api_key');
      if (!apiKey) throw new AiError('missing_key', 'gemini', 'AI provider key is not configured');

      const sevenDaysAgo = Date.now() - 7 * 86400000;
      const expenses = await databaseService.getExpenses();
      const weeklyExpenses = expenses.filter(e => e.created_at >= sevenDaysAgo);

      if (weeklyExpenses.length === 0) {
        return 'You had no recorded expenses in the past week. A clean slate, or maybe something slipped through the cracks?';
      }

      const totalSpend = weeklyExpenses.reduce((sum, e) => sum + e.amount, 0);
      const topCategory = weeklyExpenses.reduce<{ category: string; total: number }[]>((acc, e) => {
        const existing = acc.find(a => a.category === e.category);
        if (existing) existing.total += e.amount;
        else acc.push({ category: e.category, total: e.amount });
        return acc;
      }, []).sort((a, b) => b.total - a.total)[0];

      const biggestExpense = [...weeklyExpenses].sort((a, b) => b.amount - a.amount)[0];
      const userCurrency = resolveDisplayCurrency(await databaseService.getSetting('currency'), weeklyExpenses[0]?.currency);
      const fourteenDaysAgo = Date.now() - 14 * 86400000;
      const prevWeekExpenses = expenses.filter(e => e.created_at >= fourteenDaysAgo && e.created_at < sevenDaysAgo);
      const prevTotal = prevWeekExpenses.reduce((sum, e) => sum + e.amount, 0);
      const changePercent = prevTotal > 0 ? ((totalSpend - prevTotal) / prevTotal) * 100 : 0;

      const summaryData = `Weekly spending summary for the past 7 days:
- Total spent: ${formatCurrency(totalSpend, userCurrency)}
- Previous week total: ${formatCurrency(prevTotal, userCurrency)}
- Change: ${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(1)}%
- Top category: ${topCategory?.category || 'N/A'} (${formatCurrency(topCategory?.total || 0, userCurrency)})
- Biggest expense: ${biggestExpense?.merchant || 'N/A'} (${formatCurrency(biggestExpense?.amount || 0, biggestExpense?.currency, userCurrency)})
- Number of transactions: ${weeklyExpenses.length}`;

      const prompt = `You are a friendly financial coach. Given the following weekly spending summary, write a 2-3 sentence natural language insight. Be encouraging and include one actionable observation. Keep it conversational and under 80 words.

${summaryData}

Return ONLY the text, no JSON, no markdown.`;

      const response = await geminiClient.generate({ feature: 'narrative_insight', prompt, model: 'gemini-2.5-flash' }, apiKey);
      return response.text.trim();
    } catch (error) {
      const normalized = normalizeAiError(error, 'gemini');
      logger.error('Weekly digest generation failed', normalized.code);
      throw normalized;
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
