import { describe, expect, it, vi } from 'vitest';
import type { Expense } from '../types/database';
import type {
  CaptureCandidate,
  DetectionAlertContent,
  PendingAlertAction,
  SaveResolution,
} from '../data/contracts';
import type { DetectionDraft, DetectionDraftInput } from '../data/DetectionDrafts';
import { parseAlertAction } from '../data/NativeAutoCaptureAdapter';
import { createOptionalAutoCaptureSourceAdapter } from '../data/AutoCaptureSource';
import {
  applyAlertAction,
  buildDetectionInboxRow,
  raiseDetectionAlert,
  sourceLabelFor,
  type DetectionInboxRow,
} from './DetectionAlertService';

// Vitest hoists these above the imports at transform time, so the mocked
// modules below resolve to the factories while eslint sees imports first.
// The scan screen suite uses the same two-module mock shape.
vi.mock('react-native', () => ({
  Platform: { OS: 'android' },
}));
vi.mock('expo-modules-core', () => ({
  requireOptionalNativeModule: () => null,
}));

const NOW = 1_790_000_000_000;

function candidate(): CaptureCandidate {
  return {
    merchant: 'OPay',
    amount: 5000,
    currency: 'NGN',
    category: 'other',
    date: NOW,
    source: 'auto_capture',
    origin: 'auto_capture',
    note: 'Detected from OPay',
  };
}

function storedDraft(overrides: Partial<DetectionDraft> = {}): DetectionDraft {
  return {
    id: 'draft-1',
    merchant: 'OPay',
    amount: 5000,
    currency: 'NGN',
    category: 'other',
    note: 'Detected from OPay',
    source: 'auto_capture',
    detectedAt: NOW,
    snoozedUntil: null,
    status: 'pending',
    notificationId: 'row-1',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('sourceLabelFor', () => {
  it('strips the detected from prefix and falls back honestly', () => {
    expect(sourceLabelFor({ note: 'Detected from OPay' })).toBe('OPay');
    expect(sourceLabelFor({})).toBe('Payment app');
    expect(sourceLabelFor({ note: 'Detected from ' })).toBe('Payment app');
    expect(sourceLabelFor({ note: 'Something else' })).toBe('Payment app');
  });
});

describe('buildDetectionInboxRow', () => {
  it('links the draft id and carries formatted parsed fields only', () => {
    const row = buildDetectionInboxRow('draft-9', candidate(), 'NGN 5,000.00', 'OPay');
    expect(row.type).toBe('transaction');
    expect(JSON.parse(row.data)).toEqual({ draftId: 'draft-9' });
    expect(row.title).toContain('OPay');
    expect(row.body).toContain('OPay');
  });
});

describe('raiseDetectionAlert', () => {
  function deps(overrides: Partial<{
    createDraft: (input: DetectionDraftInput) => Promise<DetectionDraft>;
    linkDraftRow: (draftId: string, notificationId: string) => Promise<DetectionDraft | null>;
    insertInboxRow: (row: DetectionInboxRow) => Promise<void>;
    showAlert: (content: DetectionAlertContent) => Promise<{ posted: boolean }>;
  }> = {}) {
    const rows: DetectionInboxRow[] = [];
    const alerts: DetectionAlertContent[] = [];
    return {
      rows,
      alerts,
      createDraft: overrides.createDraft ?? (async (input: DetectionDraftInput) => storedDraft({
        merchant: input.merchant,
        amount: input.amount,
        currency: input.currency,
      })),
      linkDraftRow: overrides.linkDraftRow ?? (async (draftId: string, notificationId: string) => storedDraft({ id: draftId, notificationId })),
      insertInboxRow: overrides.insertInboxRow ?? (async (row: DetectionInboxRow) => { rows.push(row); }),
      showAlert: overrides.showAlert ?? (async (content: DetectionAlertContent) => { alerts.push(content); return { posted: true }; }),
    };
  }

  it('creates the draft, links the row both ways, and posts the alert', async () => {
    const ports = deps();
    const raised = await raiseDetectionAlert(ports, candidate(), NOW);
    expect(raised.inboxId).toBe(ports.rows[0].id);
    expect(raised.draft.notificationId).toBe(raised.inboxId);
    expect(JSON.parse(ports.rows[0].data)).toEqual({ draftId: raised.draft.id });
    expect(raised.posted).toBe(true);
    expect(ports.alerts[0]).toMatchObject({ draftId: raised.draft.id, merchant: 'OPay', sourceLabel: 'OPay' });
    expect(ports.alerts[0].amountText).toContain('5');
  });

  it('keeps the draft and row when the native post refuses, reporting not posted', async () => {
    const ports = deps({ showAlert: async () => { throw new Error('denied'); } });
    const raised = await raiseDetectionAlert(ports, candidate(), NOW);
    expect(raised.posted).toBe(false);
    expect(ports.rows).toHaveLength(1);
  });

  it('fails loudly when the row link cannot be set', async () => {
    const ports = deps({ linkDraftRow: async () => null });
    await expect(raiseDetectionAlert(ports, candidate(), NOW)).rejects.toThrow('Detection draft row link failed');
  });
});

describe('applyAlertAction', () => {
  const action = (name: 'confirm' | 'snooze'): PendingAlertAction => ({ draftId: 'draft-1', action: name, receivedAt: NOW });

  it('confirms through the shared boundary and cancels the ping', async () => {
    const canceled: string[] = [];
    const confirmDraft = vi.fn(async () => ({ status: 'confirmed', draft: storedDraft(), expenseId: 'exp-1' }) as const);
    const resolveSave = vi.fn(async (): Promise<SaveResolution<Expense>> => { throw new Error('unused'); });
    const outcome = await applyAlertAction(
      { confirmDraft, snoozeDraft: vi.fn(), cancelAlert: async (id: string) => { canceled.push(id); }, resolveSave },
      action('confirm'),
    );
    expect(outcome).toEqual({ status: 'confirmed', expenseId: 'exp-1' });
    expect(confirmDraft).toHaveBeenCalledOnce();
    expect(canceled).toEqual(['draft-1']);
  });

  it('clears the ping on a duplicate without resolving the draft', async () => {
    const canceled: string[] = [];
    const outcome = await applyAlertAction(
      {
        confirmDraft: async () => ({ status: 'duplicate', duplicate: { existing: {}, reason: 'merchant_amount_24h' } }) as never,
        snoozeDraft: vi.fn(),
        cancelAlert: async (id: string) => { canceled.push(id); },
        resolveSave: vi.fn(),
      },
      action('confirm'),
    );
    expect(outcome).toEqual({ status: 'duplicate' });
    expect(canceled).toEqual(['draft-1']);
  });

  it('snoozes 24 hours and never resolves the draft', async () => {
    const canceled: string[] = [];
    const snoozeDraft = vi.fn(async () => ({ status: 'snoozed', snoozedUntil: NOW + 86_400_000, draft: storedDraft() }) as const);
    const outcome = await applyAlertAction(
      { confirmDraft: vi.fn(), snoozeDraft, cancelAlert: async (id: string) => { canceled.push(id); }, resolveSave: vi.fn() },
      action('snooze'),
    );
    expect(outcome).toEqual({ status: 'snoozed', snoozedUntil: NOW + 86_400_000 });
    expect(canceled).toEqual(['draft-1']);
  });

  it('clears the ping for already resolved and missing drafts', async () => {
    const canceled: string[] = [];
    const ports = {
      confirmDraft: async () => ({ status: 'already_resolved', id: 'draft-1' }) as const,
      snoozeDraft: async () => ({ status: 'not_found', id: 'draft-1' }) as const,
      cancelAlert: async (id: string) => { canceled.push(id); },
      resolveSave: vi.fn(),
    };
    expect(await applyAlertAction(ports, action('confirm'))).toEqual({ status: 'already_resolved' });
    expect(await applyAlertAction(ports, action('snooze'))).toEqual({ status: 'not_found' });
    expect(canceled).toEqual(['draft-1', 'draft-1']);
  });
});

describe('parseAlertAction', () => {
  it('accepts well formed confirm and snooze records', () => {
    expect(parseAlertAction({ draftId: 'd1', action: 'confirm', receivedAt: '100' })).toEqual({
      draftId: 'd1',
      action: 'confirm',
      receivedAt: 100,
    });
    expect(parseAlertAction({ draftId: 'd1', action: 'snooze', receivedAt: '200' })).toEqual({
      draftId: 'd1',
      action: 'snooze',
      receivedAt: 200,
    });
  });

  it('rejects malformed records so nothing misfires', () => {
    expect(parseAlertAction(null)).toBeNull();
    expect(parseAlertAction({ draftId: '', action: 'confirm', receivedAt: '1' })).toBeNull();
    expect(parseAlertAction({ draftId: 'd1', action: 'launch', receivedAt: '1' })).toBeNull();
    expect(parseAlertAction({ draftId: 'd1', action: 'confirm', receivedAt: 'soon' })).toBeNull();
    expect(parseAlertAction({ draftId: 'd1', action: 'confirm' })).toBeNull();
  });
});

describe('unavailable adapter alert fallbacks', () => {
  it('posts nothing and drains nothing on iOS', async () => {
    const adapter = createOptionalAutoCaptureSourceAdapter('ios');
    await expect(adapter.showDetectionAlert?.({
      draftId: 'd1',
      merchant: 'OPay',
      amountText: '5',
      sourceLabel: 'OPay',
      timeText: 'now',
    })).resolves.toEqual({ posted: false });
    await expect(adapter.consumePendingAlertAction?.()).resolves.toBeNull();
    expect(adapter.subscribeAlertActions?.(() => undefined)).toBeTypeOf('function');
  });
});
