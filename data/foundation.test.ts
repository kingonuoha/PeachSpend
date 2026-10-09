import { describe, expect, it } from 'vitest';
import { processAutoCaptureQueue } from './AutoCaptureQueue';
import { extractJsonObject, parseReceiptResponse } from '../ai/parsing';
import { AiError, normalizeAiError } from '../ai/contracts';
import { buildDiagnosticActivity } from './contracts';
import type { CaptureEventRead, CaptureRepository, QueuedCapture } from './contracts';

describe('foundation contracts', () => {
  it('extracts nested JSON without greedy parsing', () => {
    expect(extractJsonObject('answer {"items":[{"note":"x"}]} trailing')).toEqual({ items: [{ note: 'x' }] });
  });

  it('rejects receipt arithmetic drift', () => {
    expect(() => parseReceiptResponse('{"legibility":"good","items":[{"merchant":"Shop","amount":5,"unit_price":3,"units":2,"category":"groceries","currency":"EUR"}]}')).toThrow('arithmetic');
  });

  it.each(['merchant', 'amount', 'category', 'currency'] as const)('rejects missing %s without emitting fallback data', field => {
    const item = { merchant: 'Shop', amount: 5, category: 'groceries', currency: 'EUR' };
    delete item[field];
    expect(() => parseReceiptResponse(JSON.stringify({ legibility: 'good', items: [item] }))).toThrowError(expect.objectContaining({ code: 'invalid_response' }));
  });

  it('rejects non-object items with typed parse error', () => {
    expect(() => parseReceiptResponse('{"legibility":"good","items":[null]}')).toThrowError(expect.objectContaining({ code: 'invalid_response' }));
  });

  it('preserves valid parsed source fields', () => {
    const result = parseReceiptResponse('{"legibility":"good","items":[{"merchant":"Shop","amount":5,"category":"groceries","currency":"eur"}]}');
    expect(result.items[0]).toMatchObject({ merchant: 'Shop', amount: 5, category: 'groceries', currency: 'EUR' });
    expect(result.items[0]).not.toMatchObject({ merchant: 'Unknown Merchant', amount: 0, category: 'other', currency: 'USD' });
  });

  it('retries failed auto-captures with bounded backoff', async () => {
    const item: QueuedCapture = { id: 'q1', attempts: 1, payload: { merchant: 'Shop', amount: 5, currency: 'USD', category: 'other', date: 1, source: 'auto_capture' } };
    const completed: string[] = []; const failed: string[] = [];
    const repository = { claimQueuedAutoCaptures: async () => [item], completeQueuedAutoCapture: async (id: string) => { completed.push(id); }, failQueuedAutoCapture: async (id: string) => { failed.push(id); }, } as unknown as CaptureRepository;
    const result = await processAutoCaptureQueue(repository, async () => { throw new Error('offline'); }, 1000);
    expect(result).toEqual({ processed: 0, deferred: 1 });
    expect(completed).toEqual([]); expect(failed).toEqual(['q1']);
  });

  it('normalizes unknown provider failures without exposing provider text', () => {
    const error = normalizeAiError(new Error('secret provider response'), 'openrouter');
    expect(error).toBeInstanceOf(AiError);
    expect(error.code).toBe('provider');
    expect(error.message).toBe('AI provider request failed');
  });

  it('maps diagnostic activity rows to ready or empty without a fixture log', () => {
    const event: CaptureEventRead = {
      id: 'e1', source: 'auto_capture', status: 'confirmed', merchant: 'Cafe', amount: 12,
      category: 'dining', errorCode: null, createdAt: 1, updatedAt: 1,
    };
    expect(buildDiagnosticActivity([event])).toEqual({ status: 'ready', entries: [event] });
    expect(buildDiagnosticActivity([])).toEqual({ status: 'empty' });
  });
});
