import { describe, expect, it } from 'vitest';
import {
  AI_ERROR_CODES,
  AiError,
  failedAiOperation,
  getAiErrorMessage,
  getReceiptOcrAvailability,
  idleAiOperation,
  isAiOperationBusy,
  loadingAiOperation,
  normalizeAiError,
  successAiOperation,
  type AiErrorCode,
  type AiMessageContext,
} from './contracts';

describe('AI operation state', () => {
  it('tracks idle, loading and success without a terminal error', () => {
    expect(idleAiOperation('chat')).toEqual({ feature: 'chat', phase: 'idle', retryable: false });
    const loading = loadingAiOperation('receipt_ocr');
    expect(isAiOperationBusy(loading)).toBe(true);
    expect(loading.errorCode).toBeUndefined();
    expect(isAiOperationBusy(successAiOperation('receipt_ocr'))).toBe(false);
  });

  it('classifies offline and cancelled failures as distinct phases', () => {
    const offline = failedAiOperation(new TypeError('network down'), 'openrouter', 'chat');
    expect(offline).toEqual({ feature: 'chat', phase: 'offline', errorCode: 'offline', retryable: true });
    const cancelled = failedAiOperation(new AiError('cancelled', 'gemini', 'request cancelled'), 'gemini', 'chat');
    expect(cancelled).toEqual({ feature: 'chat', phase: 'cancelled', errorCode: 'cancelled', retryable: false });
    // An AbortError surface normalizes to the retryable timeout classification.
    const timeout = failedAiOperation(new DOMException('aborted', 'AbortError'), 'gemini', 'chat');
    expect(timeout).toEqual({ feature: 'chat', phase: 'error', errorCode: 'timeout', retryable: true });
  });

  it('carries only classification, never provider message or key material', () => {
    const state = failedAiOperation(new AiError('unauthorized', 'gemini', 'key sk-secret leaked'), 'gemini', 'receipt_ocr');
    expect(state).toEqual({ feature: 'receipt_ocr', phase: 'error', errorCode: 'unauthorized', retryable: false });
    expect(Object.keys(state).sort()).toEqual(['errorCode', 'feature', 'phase', 'retryable']);
    expect(JSON.stringify(state)).not.toContain('sk-secret');
  });
});

describe('AI capture boundaries', () => {
  it('preflights offline and missing-key states', () => {
    expect(getReceiptOcrAvailability(false, true)).toBe('offline');
    expect(getReceiptOcrAvailability(true, false)).toBe('missing_key');
    expect(getReceiptOcrAvailability(true, true)).toBe('ready');
  });

  it('normalizes timeout and illegible receipt errors without provider bodies', () => {
    const timeout = normalizeAiError(new DOMException('aborted', 'AbortError'), 'openrouter');
    expect(timeout.code).toBe('timeout');
    const illegible = new AiError('illegible_image', 'gemini', 'internal detail');
    expect(getAiErrorMessage(illegible.code, 'receipt')).toBe('Receipt image could not be read. Retake the photo and try again.');
    expect(illegible.message).not.toContain('key');
  });
});

describe('AI failure message table', () => {
  const CONTEXTS: AiMessageContext[] = ['receipt', 'chat', 'product'];

  it('returns a distinct, non empty sentence for every code in every context', () => {
    for (const context of CONTEXTS) {
      const sentences = AI_ERROR_CODES.map((code) => getAiErrorMessage(code, context));
      for (const sentence of sentences) {
        expect(sentence.trim().length).toBeGreaterThan(0);
      }
      expect(new Set(sentences).size).toBe(AI_ERROR_CODES.length);
    }
  });

  it('defaults to the chat context', () => {
    for (const code of AI_ERROR_CODES) {
      expect(getAiErrorMessage(code)).toBe(getAiErrorMessage(code, 'chat'));
    }
  });

  it('keeps the two previously collapsed codes apart in receipt and product mode', () => {
    const collapsed = 'Receipt could not be processed. Try a clearer image.';
    for (const context of ['receipt', 'product'] as const) {
      const illegible = getAiErrorMessage('illegible_image', context);
      const invalid = getAiErrorMessage('invalid_response', context);
      expect(illegible).not.toBe(invalid);
      expect(illegible).not.toBe(collapsed);
      expect(invalid).not.toBe(collapsed);
    }
  });

  it('never blames blur or lighting for any code, because the app never establishes either', () => {
    for (const context of CONTEXTS) {
      for (const code of AI_ERROR_CODES) {
        const sentence = getAiErrorMessage(code, context).toLowerCase();
        expect(sentence).not.toContain('blur');
        expect(sentence).not.toContain('dim');
        expect(sentence).not.toContain('lighting');
      }
    }
  });

  it('never offers a clearer image as the remedy for a response it could not use', () => {
    expect(getAiErrorMessage('invalid_response', 'receipt')).not.toContain('clearer image');
    expect(getAiErrorMessage('invalid_response', 'product')).not.toContain('clearer image');
  });

  it('names the scanned object per mode and never describes a product in receipt terms', () => {
    const receiptNouns = ['receipt', 'merchant', 'total', 'store', 'till', 'cashier'];
    for (const code of AI_ERROR_CODES) {
      const product = getAiErrorMessage(code, 'product').toLowerCase();
      for (const noun of receiptNouns) {
        expect(product).not.toContain(noun);
      }
    }
    expect(getAiErrorMessage('illegible_image', 'receipt')).toContain('Receipt');
    expect(getAiErrorMessage('invalid_response', 'receipt')).toContain('receipt');
    expect(getAiErrorMessage('illegible_image', 'product')).toContain('Product');
    expect(getAiErrorMessage('invalid_response', 'product')).toContain('product');
  });

  it('keeps provider level failures identical across modes, which is why they carry no mode noun', () => {
    for (const code of AI_ERROR_CODES) {
      if (code === 'illegible_image' || code === 'invalid_response') continue;
      expect(getAiErrorMessage(code, 'receipt')).toBe(getAiErrorMessage(code, 'chat'));
      expect(getAiErrorMessage(code, 'product')).toBe(getAiErrorMessage(code, 'chat'));
    }
  });

  it('pins the sentences this row did not change', () => {
    const unchanged: Record<Exclude<AiErrorCode, 'illegible_image' | 'invalid_response'>, string> = {
      offline: 'AI provider is unavailable offline.',
      missing_key: 'AI provider key is not configured.',
      unauthorized: 'AI provider authorization failed.',
      rate_limited: 'AI provider rate limit reached. Try again later.',
      timeout: 'AI provider request timed out. Try again.',
      cancelled: 'AI provider request was cancelled.',
      provider: 'AI provider request failed. Try again.',
    };
    for (const code of AI_ERROR_CODES) {
      if (code === 'illegible_image' || code === 'invalid_response') continue;
      for (const context of CONTEXTS) {
        expect(getAiErrorMessage(code, context)).toBe(unchanged[code]);
      }
    }
    // The chat sentences for the two unflattened codes are unchanged as well, since the
    // collapse this row removes only ever applied to the receipt context.
    expect(getAiErrorMessage('illegible_image', 'chat')).toBe('Receipt image is not clear enough. Try again.');
    expect(getAiErrorMessage('invalid_response', 'chat')).toBe('AI provider returned an invalid response.');
  });
});
