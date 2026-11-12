import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { PendingAlertAction, PendingNativeDetection, SaveResolution } from '../data/contracts';
import type { DetectionDraft, DetectionDraftInput, IncomeDetectionDraftInput } from '../data/DetectionDrafts';
import type { Expense, Income } from '../types/database';
import { createOptionalAutoCaptureSourceAdapter } from '../data/AutoCaptureSource';
import { parsePendingNativeDetection } from '../data/NativeAutoCaptureAdapter';
import { applyAlertAction, type DetectionInboxRow } from './DetectionAlertService';
import {
  drainNativeDetectionsWithDeps,
  drainPendingNativeAndAlertActions,
} from './NativeDetectionDrainService';

vi.mock('react-native', () => ({
  Platform: { OS: 'android' },
}));
vi.mock('expo-modules-core', () => ({
  requireOptionalNativeModule: () => null,
}));
vi.mock('./DatabaseService', () => ({
  databaseService: {},
}));

const NOW = 1_794_257_880_000;

function expenseDetection(overrides: Partial<PendingNativeDetection> = {}): PendingNativeDetection {
  return {
    draftId: 'native-11111111-1111-4111-8111-111111111111',
    sourceId: 'opay',
    packageName: 'team.opay.pay',
    appName: 'OPay',
    receivedAt: NOW,
    amount: 2000,
    currency: 'NGN',
    kind: 'expense',
    merchant: 'Transfer Via E-Channel',
    sourceName: null,
    confidence: null,
    directionAmbiguous: false,
    note: 'Detected from OPay',
    ...overrides,
  };
}

function incomeDetection(overrides: Partial<PendingNativeDetection> = {}): PendingNativeDetection {
  return {
    draftId: 'native-22222222-2222-4222-8222-222222222222',
    sourceId: 'com.android.mms',
    packageName: 'com.android.mms',
    appName: 'Messages',
    receivedAt: NOW + 1000,
    amount: 2000,
    currency: 'NGN',
    kind: 'income',
    merchant: 'KINGSLEY U',
    sourceName: 'KINGSLEY U',
    confidence: null,
    directionAmbiguous: false,
    note: 'Detected from Messages',
    ...overrides,
  };
}

function createMemoryHarness(queue: PendingNativeDetection[]) {
  const drafts = new Map<string, DetectionDraft>();
  const rows: DetectionInboxRow[] = [];

  const deps = {
    consumeNext: async () => queue.shift() ?? null,
    getDraft: async (id: string) => drafts.get(id) ?? null,
    createExpenseDraft: async (input: DetectionDraftInput): Promise<DetectionDraft> => {
      const id = input.id?.trim() || `gen-${drafts.size + 1}`;
      const existing = drafts.get(id);
      if (existing) return existing;
      const created: DetectionDraft = {
        id,
        merchant: input.merchant,
        amount: input.amount,
        currency: input.currency,
        category: input.category ?? 'other',
        note: input.note ?? null,
        source: input.source ?? 'auto_capture',
        detectedAt: input.detectedAt ?? NOW,
        snoozedUntil: null,
        status: 'pending',
        notificationId: input.notificationId ?? null,
        createdAt: NOW,
        updatedAt: NOW,
        kind: 'expense',
        origin: 'auto_capture',
        sourceName: null,
      };
      drafts.set(id, created);
      return created;
    },
    createIncomeDraft: async (input: IncomeDetectionDraftInput): Promise<DetectionDraft> => {
      const id = input.id?.trim() || `gen-${drafts.size + 1}`;
      const existing = drafts.get(id);
      if (existing) return existing;
      const created: DetectionDraft = {
        id,
        merchant: input.sourceName,
        amount: input.amount,
        currency: input.currency,
        category: input.category ?? 'other',
        note: input.note ?? null,
        source: input.source ?? 'auto_capture',
        detectedAt: input.detectedAt ?? NOW,
        snoozedUntil: null,
        status: 'pending',
        notificationId: input.notificationId ?? null,
        createdAt: NOW,
        updatedAt: NOW,
        kind: 'income',
        origin: input.origin ?? 'auto_capture',
        sourceName: input.sourceName,
      };
      drafts.set(id, created);
      return created;
    },
    linkDraftRow: async (draftId: string, notificationId: string) => {
      const draft = drafts.get(draftId);
      if (!draft) return null;
      const updated = { ...draft, notificationId };
      drafts.set(draftId, updated);
      return updated;
    },
    insertInboxRow: async (row: DetectionInboxRow) => {
      rows.push(row);
    },
  };

  return { deps, drafts, rows };
}

describe('parsePendingNativeDetection', () => {
  it('parses valid expense and income native records', () => {
    const exp = parsePendingNativeDetection({
      draftId: 'native-abc',
      sourceId: 'opay',
      packageName: 'team.opay.pay',
      appName: 'OPay',
      receivedAt: NOW,
      amount: 2000,
      currency: 'ngn',
      kind: 'expense',
      merchant: 'Shoprite',
      sourceName: null,
      confidence: null,
      directionAmbiguous: false,
      note: 'Detected from OPay',
    });
    expect(exp).toMatchObject({
      draftId: 'native-abc',
      currency: 'NGN',
      kind: 'expense',
      merchant: 'Shoprite',
      amount: 2000,
    });

    const inc = parsePendingNativeDetection({
      draftId: 'native-def',
      sourceId: 'com.android.mms',
      packageName: 'com.android.mms',
      appName: 'Messages',
      receivedAt: NOW,
      amount: 5000,
      currency: 'NGN',
      kind: 'income',
      merchant: 'KINGSLEY U',
      sourceName: 'KINGSLEY U',
      directionAmbiguous: false,
      note: 'Detected from Messages',
    });
    expect(inc).toMatchObject({
      draftId: 'native-def',
      kind: 'income',
      sourceName: 'KINGSLEY U',
    });
  });

  it('rejects malformed native records without throwing', () => {
    expect(parsePendingNativeDetection(null)).toBeNull();
    expect(parsePendingNativeDetection({ draftId: '', packageName: 'a', merchant: 'm', currency: 'NGN', kind: 'expense', receivedAt: NOW, amount: 100 })).toBeNull();
    expect(parsePendingNativeDetection({ draftId: 'native-1', packageName: 'a', merchant: 'm', currency: 'NGN', kind: 'transfer', receivedAt: NOW, amount: 100 })).toBeNull();
    expect(parsePendingNativeDetection({ draftId: 'native-1', packageName: 'a', merchant: 'm', currency: 'NGN', kind: 'expense', receivedAt: NOW, amount: 0 })).toBeNull();
    expect(parsePendingNativeDetection({ draftId: 'native-1', packageName: 'a', merchant: 'm', currency: 'NGN', kind: 'expense', receivedAt: 0, amount: 100 })).toBeNull();
  });
});

describe('drainNativeDetectionsWithDeps', () => {
  it('preserves exact native draftId for expense and income detections and links inbox rows', async () => {
    const exp = expenseDetection();
    const inc = incomeDetection();
    const { deps, drafts, rows } = createMemoryHarness([exp, inc]);

    const count = await drainNativeDetectionsWithDeps(deps);
    expect(count).toBe(2);

    const savedExp = drafts.get(exp.draftId);
    const savedInc = drafts.get(inc.draftId);
    expect(savedExp).toMatchObject({
      id: exp.draftId,
      merchant: 'Transfer Via E-Channel',
      amount: 2000,
      currency: 'NGN',
      kind: 'expense',
    });
    expect(savedInc).toMatchObject({
      id: inc.draftId,
      merchant: 'KINGSLEY U',
      sourceName: 'KINGSLEY U',
      kind: 'income',
    });
    expect(rows).toHaveLength(2);
    expect(JSON.parse(rows[0].data)).toEqual({ draftId: exp.draftId });
    expect(JSON.parse(rows[1].data)).toEqual({ draftId: inc.draftId });
    expect(rows[1].title).toBe('Income detected: KINGSLEY U');
    expect(savedExp?.notificationId).toBe(rows[0].id);
    expect(savedInc?.notificationId).toBe(rows[1].id);
  });

  it('is idempotent when the same draftId is drained twice', async () => {
    const exp = expenseDetection();
    const { deps, drafts, rows } = createMemoryHarness([exp, exp]);

    const count = await drainNativeDetectionsWithDeps(deps);
    expect(count).toBe(1);
    expect(drafts.size).toBe(1);
    expect(rows).toHaveLength(1);
  });
});

describe('drainPendingNativeAndAlertActions ordering', () => {
  it('drains native detections before applying pending Confirm actions on those native draftIds', async () => {
    const exp = expenseDetection();
    const inc = incomeDetection();
    const { deps, drafts } = createMemoryHarness([exp, inc]);
    const actions: PendingAlertAction[] = [
      { draftId: exp.draftId, action: 'confirm', receivedAt: NOW + 500 },
      { draftId: inc.draftId, action: 'confirm', receivedAt: NOW + 1500 },
    ];
    const order: string[] = [];
    const canceled: string[] = [];

    await drainPendingNativeAndAlertActions({
      drainNative: async () => {
        order.push('drain_native');
        return drainNativeDetectionsWithDeps(deps);
      },
      consumeNextAction: async () => actions.shift() ?? null,
      applyAction: async action => {
        order.push(`apply:${action.draftId}`);
        const outcome = await applyAlertAction(
          {
            getDraft: deps.getDraft,
            confirmDraft: async id => {
              const found = drafts.get(id);
              if (!found) return { status: 'not_found', id };
              drafts.set(id, { ...found, status: 'confirmed' });
              return { status: 'confirmed', draft: found, expenseId: 'exp-1' };
            },
            confirmIncomeDraft: async id => {
              const found = drafts.get(id);
              if (!found) return { status: 'not_found', id };
              drafts.set(id, { ...found, status: 'confirmed' });
              return { status: 'confirmed', draft: found, incomeId: 'inc-1' };
            },
            snoozeDraft: async id => ({ status: 'not_found', id }),
            cancelAlert: async id => {
              canceled.push(id);
            },
            resolveSave: vi.fn(async (): Promise<SaveResolution<Expense>> => {
              throw new Error('unused');
            }),
            resolveIncomeSave: vi.fn(async (): Promise<SaveResolution<Income>> => {
              throw new Error('unused');
            }),
          },
          action,
        );
        expect(outcome.status).toBe('confirmed');
      },
    });

    expect(order).toEqual(['drain_native', `apply:${exp.draftId}`, `apply:${inc.draftId}`]);
    expect(drafts.get(exp.draftId)?.status).toBe('confirmed');
    expect(drafts.get(inc.draftId)?.status).toBe('confirmed');
    expect(canceled).toEqual([exp.draftId, inc.draftId]);
  });
});

describe('unavailable adapter fallbacks and root biometric gate ordering', () => {
  it('returns null and false on unsupported and unavailable adapters without crashing', async () => {
    const ios = createOptionalAutoCaptureSourceAdapter('ios');
    const expoGo = createOptionalAutoCaptureSourceAdapter('android');
    await expect(ios.consumePendingNativeDetections?.()).resolves.toBeNull();
    await expect(expoGo.consumePendingNativeDetections?.()).resolves.toBeNull();
    await expect(ios.openAutostartSettings?.()).resolves.toBe(false);
    await expect(expoGo.openAutostartSettings?.()).resolves.toBe(false);
  });

  it('mounts DetectionAlertActionHost outside BiometricGate while keeping financial UI sheets inside', () => {
    const layout = readFileSync(resolve(__dirname, '../app/_layout.tsx'), 'utf8');
    const gateOpen = layout.indexOf('<BiometricGate>');
    const gateClose = layout.indexOf('</BiometricGate>');
    const actionHost = layout.indexOf('<DetectionAlertActionHost />');
    const confirmHost = layout.indexOf('<AutoCaptureConfirmHost />');
    const staleHost = layout.indexOf('<StaleReviewHost />');

    expect(gateOpen).toBeGreaterThan(-1);
    expect(gateClose).toBeGreaterThan(gateOpen);
    expect(actionHost).toBeGreaterThan(-1);
    expect(actionHost).toBeLessThan(gateOpen);
    expect(confirmHost).toBeGreaterThan(gateOpen);
    expect(confirmHost).toBeLessThan(gateClose);
    expect(staleHost).toBeGreaterThan(gateOpen);
    expect(staleHost).toBeLessThan(gateClose);
  });
});
