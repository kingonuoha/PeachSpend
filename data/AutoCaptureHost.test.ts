import { describe, expect, it, vi } from 'vitest';
import { RootAutoCaptureHost, createAutoCaptureEvent } from './AutoCaptureHost';
import { resolveExpenseSave } from './CaptureService';
import type { CaptureCandidate, CaptureRepository } from './contracts';

const candidate: CaptureCandidate = {
  merchant: 'Market', amount: 12, currency: 'USD', category: 'groceries', date: 1, source: 'auto_capture',
};

function repository(): CaptureRepository {
  return { enqueueAutoCapture: vi.fn().mockResolvedValue('queue-1'), discardQueuedAutoCaptures: vi.fn().mockResolvedValue(undefined), recordEvent: vi.fn().mockResolvedValue('event') } as unknown as CaptureRepository;
}

describe('RootAutoCaptureHost', () => {
  it('stays inert while disabled or permission is unavailable', async () => {
    const source = { subscribe: vi.fn() };
    const host = new RootAutoCaptureHost(repository());
    host.start(source);
    expect(host.getState()).toMatchObject({ enabled: false, permission: 'unsupported', listenerAvailable: false });
    expect(host.claimOverlay()).toBeNull();
    expect(source.subscribe).not.toHaveBeenCalled();
  });

  it('does not promote cached permission without a listener source', () => {
    const host = new RootAutoCaptureHost(repository());
    host.setPermission('granted');
    host.setEnabled(true);
    expect(host.getState()).toMatchObject({ enabled: false, permission: 'granted' });
  });

  it('keeps detection in memory until confirmation', async () => {
    const listeners: ((event: ReturnType<typeof createAutoCaptureEvent>) => void)[] = [];
    const repo = repository();
    const source = { subscribe: (listener: (event: ReturnType<typeof createAutoCaptureEvent>) => void) => { listeners.push(listener); return () => undefined; } };
    const host = new RootAutoCaptureHost(repo);
    host.start(source);
    host.setPermission('granted');
    host.setEnabled(true);
    expect(host.getState()).toMatchObject({ enabled: true, permission: 'granted', listenerAvailable: true });

    listeners[0](createAutoCaptureEvent(candidate, 10));
    listeners[0](createAutoCaptureEvent({ ...candidate, merchant: 'Cafe' }, 11));
    await Promise.resolve();

    expect(repo.enqueueAutoCapture).not.toHaveBeenCalled();
    expect(host.claimOverlay()?.candidate.merchant).toBe('Market');
    expect(host.claimOverlay()?.candidate.merchant).toBe('Market');
    host.releaseOverlay();
    expect(host.claimOverlay()?.candidate.merchant).toBe('Cafe');
  });

  it('owns subscription lifecycle, deduplicates events, and clears drafts on revoke', async () => {
    const listeners: ((event: ReturnType<typeof createAutoCaptureEvent>) => void)[] = [];
    const repo = repository();
    const source = { subscribe: (listener: (event: ReturnType<typeof createAutoCaptureEvent>) => void) => { listeners.push(listener); return () => undefined; } };
    const host = new RootAutoCaptureHost(repo);
    host.start(source);
    host.setPermission('granted');
    host.setEnabled(true);
    const event = createAutoCaptureEvent(candidate, 10);
    listeners[0](event);
    listeners[0](event);
    host.setPermission('denied');
    listeners[0](event);
    await Promise.resolve();
    expect(repo.enqueueAutoCapture).not.toHaveBeenCalled();
    expect(host.claimOverlay()).toBeNull();
    host.setPermission('granted');
    host.setEnabled(true);
    expect(listeners).toHaveLength(2);
  });

  it('saves confirmed detection once through shared boundary, including save-anyway', async () => {
    const expenses: string[] = [];
    const captureQueue: CaptureCandidate[] = [];
    const repo = {
      ...repository(),
      findDuplicate: vi.fn().mockResolvedValue({ existing: {}, reason: 'merchant_amount_24h' }),
      save: vi.fn(async () => { expenses.push('expense-1'); return { id: 'expense-1' }; }),
      enqueueAutoCapture: vi.fn(async (value: CaptureCandidate) => { captureQueue.push(value); return 'queue-1'; }),
    } as unknown as CaptureRepository;
    const listeners: ((event: ReturnType<typeof createAutoCaptureEvent>) => void)[] = [];
    const source = { subscribe: (listener: (event: ReturnType<typeof createAutoCaptureEvent>) => void) => { listeners.push(listener); return () => undefined; } };
    const host = new RootAutoCaptureHost(repo);
    host.start(source);
    host.setPermission('granted');
    host.setEnabled(true);
    listeners[0](createAutoCaptureEvent(candidate));
    await Promise.resolve();
    const pending = host.claimOverlay();
    expect(expenses).toHaveLength(0);
    expect(captureQueue).toHaveLength(0);
    expect(repo.save).not.toHaveBeenCalled();
    expect(pending).not.toBeNull();
    const duplicate = await resolveExpenseSave(repo, pending!.candidate);
    expect(duplicate.status).toBe('duplicate');
    const saved = await resolveExpenseSave(repo, pending!.candidate, 'save_anyway');
    expect(saved.status).toBe('saved');
    expect(repo.save).toHaveBeenCalledTimes(1);
  });

  it('gates source publication on enabled and live permission without stale events', async () => {
    let publish: ((event: ReturnType<typeof createAutoCaptureEvent>) => void) | undefined;
    let allowed = false;
    const source = {
      setLifecycle: (enabled: boolean, permission: 'unsupported' | 'denied' | 'granted') => { allowed = enabled && permission === 'granted'; },
      subscribe: (listener: (event: ReturnType<typeof createAutoCaptureEvent>) => void) => { publish = event => { if (allowed) listener(event); }; return () => { publish = undefined; }; },
    };
    const host = new RootAutoCaptureHost(repository());
    host.syncLifecycle(true, 'granted', source);
    publish?.(createAutoCaptureEvent(candidate));
    await Promise.resolve();
    expect(host.claimOverlay()).not.toBeNull();
    host.syncLifecycle(false, 'granted', source);
    publish?.(createAutoCaptureEvent(candidate));
    expect(host.claimOverlay()).toBeNull();
    host.syncLifecycle(true, 'denied', source);
    expect(allowed).toBe(false);
    host.syncLifecycle(true, 'granted', source);
    expect(allowed).toBe(true);
  });
});
