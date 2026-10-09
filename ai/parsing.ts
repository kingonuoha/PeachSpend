import type { CaptureCandidate } from '../data/contracts';
import { AiError, type AiProvider } from './contracts';

export interface RawReceiptItem { merchant?: unknown; item_name?: unknown; amount?: unknown; unit_price?: unknown; units?: unknown; category?: unknown; currency?: unknown; confidence?: unknown; }

const isRawReceiptItem = (value: unknown): value is RawReceiptItem => value !== null && typeof value === 'object';

export function extractJsonObject(text: string, provider: AiProvider = 'gemini'): unknown {
  const start = text.indexOf('{');
  if (start < 0) throw new AiError('invalid_response', provider, 'AI response did not contain JSON');
  let depth = 0; let quoted = false; let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (escaped) { escaped = false; continue; }
    if (char === '\\' && quoted) { escaped = true; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (quoted) continue;
    if (char === '{') depth += 1;
    if (char === '}') { depth -= 1; if (depth === 0) { try { return JSON.parse(text.slice(start, i + 1)); } catch { break; } } }
  }
  throw new AiError('invalid_response', provider, 'AI response contained malformed JSON');
}

export function parseReceiptResponse(text: string, source: CaptureCandidate['source'] = 'ocr', provider: AiProvider = 'gemini'): { legibility: 'good' | 'poor'; items: CaptureCandidate[] } {
  const value = extractJsonObject(text, provider) as { legibility?: unknown; items?: unknown };
  const legibility = value.legibility === 'poor' ? 'poor' : value.legibility === 'good' ? 'good' : null;
  if (!legibility || !Array.isArray(value.items)) throw new AiError('invalid_response', provider, 'AI response did not match receipt contract');
  if (legibility === 'poor') return { legibility, items: [] };
  const items = value.items.map((raw, index) => {
    if (!isRawReceiptItem(raw)) throw new AiError('invalid_response', provider, `Receipt item ${index + 1} is invalid`);
    const item = raw;
    const merchant = typeof item.merchant === 'string' ? item.merchant.trim() : '';
    const amount = Number(item.amount);
    const currency = typeof item.currency === 'string' ? item.currency.trim().toUpperCase() : '';
    const category = typeof item.category === 'string' ? item.category.trim() : '';
    if (!merchant || !Number.isFinite(amount) || amount <= 0 || !currency || !category) {
      throw new AiError('invalid_response', provider, `Receipt item ${index + 1} is missing required fields`);
    }
    const units = item.units === undefined ? 1 : Number(item.units);
    const unitPrice = item.unit_price === undefined ? amount : Number(item.unit_price);
    if (!Number.isInteger(units) || units < 1 || !Number.isFinite(unitPrice) || Math.abs(unitPrice * units - amount) > 0.01) throw new AiError('invalid_response', provider, `Receipt item ${index + 1} has invalid arithmetic`);
    // Confidence is only taken from the provider response and only when it is a
    // real fraction in (0, 1]. Anything else, including no value at all, stays
    // undefined so the caller never renders a fabricated certainty.
    const reportedConfidence = item.confidence === undefined ? undefined : Number(item.confidence);
    const confidence = reportedConfidence !== undefined && Number.isFinite(reportedConfidence) && reportedConfidence > 0 && reportedConfidence <= 1 ? reportedConfidence : undefined;
    return { merchant, amount, currency, category, date: Date.now(), note: typeof item.item_name === 'string' ? item.item_name : undefined, source, unitPrice, units, ...(confidence !== undefined ? { confidence } : {}) };
  });
  if (!items.length) throw new AiError('invalid_response', provider, 'Receipt contained no items');
  return { legibility, items };
}
