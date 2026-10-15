import { ScannedReceipt } from '../types/gemini';
import { databaseService } from './DatabaseService';
import { logger } from '../utils/logger';
import { geminiClient } from '../ai/providerClients';
import { AiError, normalizeAiError, type AiProvider } from '../ai/contracts';
import { extractJsonObject, parseReceiptResponse } from '../ai/parsing';
import { formatCurrency, resolveDisplayCurrency } from '../utils/currency';
import type { CaptureCandidate } from '../data/contracts';

// Product mode has its own parse contract rather than borrowing the receipt one.
// A prompt is advisory, so it cannot be trusted to force the shape the receipt
// parser requires, and the product scenario genuinely differs from a receipt in
// two ways the receipt parser treats as fatal: the image normally shows no store
// name, and a price is often absent. So the parser here accepts what the model
// actually returns and never turns a missing merchant or price into a failure.

interface RawProductItem { merchant?: unknown; item_name?: unknown; amount?: unknown; unit_price?: unknown; units?: unknown; category?: unknown; currency?: unknown; confidence?: unknown; }

// A price the model returned, which may be a number or a string. Only an
// unambiguous value is accepted: digits with optional thousands grouping and an
// optional decimal part, with any surrounding currency symbol or code ignored.
// Anything ambiguous is refused rather than guessed, so a price is never
// misread, matching the one money rule the rest of the app uses (DEC-B09).
function coerceMoney(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value !== 'string') return null;
  const digits = value.trim().replace(/[^\d.,]/g, '');
  const grouped = /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(digits);
  const normalized = grouped ? digits.replace(/,/g, '') : digits;
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

// A quantity is a whole number of at least one. Anything else, including a
// missing key, resolves to one rather than propagating NaN into the total.
function coerceUnits(value: unknown): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : Number.NaN;
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
}

// The barcode the device decoded in product mode. It is device data rather than
// model output, but it is still interpolated into a prompt, so only a plausible
// retail code survives: digits with optional grouping separators, bounded in
// length. Anything else is dropped rather than passed through (DEC-B41).
function normalizeBarcode(value: unknown): string {
  if (typeof value !== 'string') return '';
  const digits = value.replace(/[\s-]/g, '');
  return /^\d{4,18}$/.test(digits) ? digits : '';
}

// Product parse. Returns the same CaptureCandidate shape the receipt parse
// returns, so the caller maps both through one code path, but with the product
// scenario's own tolerances: merchant and price are optional, a text price is
// coerced, and a quantity is only honoured when the provider's own arithmetic
// agrees with it.
function parseProductResponse(text: string, provider: AiProvider = 'gemini'): { legibility: 'good' | 'poor'; items: CaptureCandidate[] } {
  const value = extractJsonObject(text, provider) as { legibility?: unknown; items?: unknown };
  if (!Array.isArray(value.items)) throw new AiError('invalid_response', provider, 'AI response did not match the product contract');
  const rawItems: unknown[] = value.items;
  const items = rawItems.flatMap((raw, index) => {
    if (raw === null || typeof raw !== 'object') throw new AiError('invalid_response', provider, `Product item ${index + 1} is invalid`);
    const item = raw as RawProductItem;
    const amount = coerceMoney(item.amount) ?? 0;
    const name = typeof item.item_name === 'string' ? item.item_name.trim() : '';
    // Neither a name nor a price means the item carries no information, so it is
    // dropped instead of being returned as a blank row.
    if (!name && amount <= 0) return [];
    // An absent merchant is normal for a product photo, so it stays empty. The
    // confirmation sheet already asks the user for it, exactly as it does for a
    // manual entry, rather than the scan being reported as a failure.
    const merchant = typeof item.merchant === 'string' ? item.merchant.trim() : '';
    const units = coerceUnits(item.units);
    const reportedUnitPrice = coerceMoney(item.unit_price);
    const keepQuantity = units > 1 && reportedUnitPrice !== null && Math.abs(reportedUnitPrice * units - amount) <= 0.01;
    const currency = typeof item.currency === 'string' ? item.currency.trim().toUpperCase() : '';
    const category = typeof item.category === 'string' ? item.category.trim() : '';
    // Confidence comes only from the provider and only as a real fraction in
    // (0, 1]. Anything else stays undefined, so the sheet never renders a
    // fabricated certainty.
    const reportedConfidence = item.confidence === undefined ? undefined : Number(item.confidence);
    const confidence = reportedConfidence !== undefined && Number.isFinite(reportedConfidence) && reportedConfidence > 0 && reportedConfidence <= 1 ? reportedConfidence : undefined;
    return [{
      merchant,
      amount,
      currency,
      category,
      date: Date.now(),
      note: name || undefined,
      source: 'ocr' as const,
      unitPrice: keepQuantity ? reportedUnitPrice : amount,
      units: keepQuantity ? units : 1,
      ...(confidence !== undefined ? { confidence } : {}),
    }];
  });
  if (!items.length) {
    // No usable item. An explicit poor verdict is the provider saying the image
    // itself could not be read, which stays a distinct outcome from a response
    // that simply did not match the contract.
    if (value.legibility === 'poor') return { legibility: 'poor', items: [] };
    throw new AiError('invalid_response', provider, 'AI response contained no usable product');
  }
  // A usable item is concrete evidence the image was read, so it wins over the
  // provider's own verdict. This is what stops a normal product photo, which
  // carries no merchant, from being reported as an unreadable image.
  return { legibility: 'good', items };
}

class GeminiService {
  async scanReceipt(base64Image: string, mode: 'receipt' | 'product' = 'receipt', options: { signal?: AbortSignal; barcode?: string } = {}): Promise<ScannedReceipt[]> {
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

    // The decoded code is product context only: it is appended to the product
    // prompt and nowhere else, so the receipt prompt and the receipt path are
    // byte identical to before this change (DEC-B41).
    const scannedBarcode = mode === 'product' ? normalizeBarcode(options.barcode) : '';
    const productBarcodeLine = scannedBarcode
      ? `\n      The package barcode read on this device is ${scannedBarcode}. Use it to identify the product, and never invent a different code.`
      : '';

    const productPrompt = `
      You are a product identification assistant.
      Identify the product shown in the image.${productBarcodeLine}

      FIRST, assess the legibility of the image. Set "legibility" to "poor" ONLY when no product can be identified at all, for example the image is too blurry, too dark, or shows no product.
      A product photo normally has no store name in it, and a price is often not visible. Neither of those makes the image illegible, so never set "legibility" to "poor" because a merchant or a price is missing.

      SECOND, describe the product. For each product, provide:
      - item_name: (the product name, as it appears on the item or its label)
      - amount: (the price of one unit, as a NUMBER, for example 3.5; omit this key when no price is visible)
      - unit_price: (the price per single unit as a NUMBER; the same value as amount when only one price is visible)
      - units: (the quantity shown, as a whole number; use 1 when only one item is shown)
      - category: (classify into one of: ${categoryList})
      - currency: (3-letter ISO code, only when a currency is visible on the item; omit this key when none is visible)
      - merchant: (the store name, ONLY when a store name is visible in the image; omit this key otherwise, which is the normal case)
      - confidence: (your certainty for this item as a number from 0 to 1, where 1 is fully certain; omit this key entirely if you cannot estimate it)

      Never invent a value. Never guess a merchant, a price or a currency that is not visible in the image.
      Return ONLY a valid JSON object:
      {
        "legibility": "good" | "poor",
        "items": [
          { "item_name": "...", "amount": 3.5, "unit_price": 3.5, "units": 1, "category": "...", "currency": "...", "merchant": "...", "confidence": 0.9 },
          ...
        ]
      }
    `;

    const prompt = mode === 'receipt' ? receiptPrompt : productPrompt;

    try {
      const response = await geminiClient.generate({ feature: 'receipt_ocr', prompt, imageBase64: base64Image, model: 'gemini-2.5-flash', signal: options.signal }, apiKey);
      const parsed = mode === 'receipt' ? parseReceiptResponse(response.text) : parseProductResponse(response.text);
      if (parsed.legibility === 'poor') throw new AiError('illegible_image', 'gemini', mode === 'receipt' ? 'Receipt image could not be read' : 'Product image could not be read');
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
