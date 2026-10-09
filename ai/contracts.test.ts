import { describe, expect, it } from 'vitest';
import {
  AiError,
  failedAiOperation,
  getAiErrorMessage,
  getReceiptOcrAvailability,
  idleAiOperation,
  isAiOperationBusy,
  loadingAiOperation,
  normalizeAiError,
  successAiOperation,
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
    expect(getAiErrorMessage(illegible.code, 'receipt')).toContain('clearer image');
    expect(illegible.message).not.toContain('key');
  });
});
