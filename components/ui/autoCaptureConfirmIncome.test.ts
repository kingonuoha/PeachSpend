import { describe, expect, it, vi } from 'vitest';
import type { AutoCaptureSourceDescriptor, DetectionAlertContent } from '../../data/contracts';
import type { DetectionDraft, DetectionDraftInput } from '../../data/DetectionDrafts';
import type { DetectionInboxRow } from '../../services/DetectionAlertService';
import {
  buildIncomeInboxRow,
  buildIncomeSaveCandidate,
  isIncomeOverlayCandidate,
  parseDirectedHostCandidate,
  raiseIncomeDetectionAlert,
  toIncomeCandidate,
} from './autoCaptureConfirmIncome';

// Phase 16 M3 pins. Fixtures are the two device SMS texts from brief section
// 3, masked exactly as shown, never unmasked or expanded.
const OPAY_DEBIT_TEXT =
  'DEBIT ALERT Acc:907****170 Amt:NGN2,000.00 Bal:NGN77,199.58 Date:09-Nov-2026 16:18 Des:For Transfer Via E-Channel Dial *955*100# to cancel SMS Alerts';
const UBA_CREDIT_TEXT =
  'Txn:CR Ac:2XX..31X Amt:NGN 2,000.00 Des:TNF-KINGSLEY UZOMA ONUOHA/Transfer from KINGSLEY U Date:09-11-2026 16:18 Bal:NGN 9,693.60';

const OPAY_SOURCE: AutoCaptureSourceDescriptor = {
  id: 'opay',
  packageName: 'team.opay.pay',
  displayName: 'OPay',
  status: 'active',
};
const MMS_SOURCE: AutoCaptureSourceDescriptor = {
  id: 'com.android.mms',
  packageName: 'com.android.mms',
  displayName: 'Messages',
  status: 'active',
};

const RECEIVED_AT = 1794257880000;

function notification(packageName: string, text: string) {
  return { id: 'notif-1', packageName, text, receivedAt: RECEIVED_AT };
}

describe('parseDirectedHostCandidate', () => {
  it('parses the OPay debit leg as an expense with a non footer merchant', () => {
    const candidate = parseDirectedHostCandidate(notification(OPAY_SOURCE.packageName, OPAY_DEBIT_TEXT), OPAY_SOURCE);
    expect(candidate).not.toBeNull();
    expect(candidate?.merchant).toBe('Transfer Via E-Channel');
    expect(candidate?.amount).toBe(2000);
    expect(candidate?.currency).toBe('NGN');
    expect(candidate?.note).toBe('Detected from OPay');
    expect(candidate && isIncomeOverlayCandidate(candidate)).toBe(false);
  });

  it('parses the UBA credit leg as an income hybrid with the sender preserved', () => {
    const candidate = parseDirectedHostCandidate(notification(MMS_SOURCE.packageName, UBA_CREDIT_TEXT), MMS_SOURCE);
    expect(candidate).not.toBeNull();
    if (!candidate || !isIncomeOverlayCandidate(candidate)) throw new Error('expected an income hybrid');
    expect(candidate.sourceName).toBe('KINGSLEY U');
    expect(candidate.merchant).toBe('KINGSLEY U');
    expect(candidate.amount).toBe(2000);
    expect(candidate.currency).toBe('NGN');
    expect(candidate.category).toBe('other');
    expect(candidate.note).toBe('Detected from Messages');
    expect(candidate.source).toBe('auto_capture');
    expect(candidate.origin).toBe('auto_capture');
  });

  it('keeps ambiguous direction as an expense with the ambiguity noted', () => {
    const candidate = parseDirectedHostCandidate(notification(OPAY_SOURCE.packageName, 'NGN 25,000 at Shoprite'), OPAY_SOURCE);
    expect(candidate).not.toBeNull();
    expect(candidate && isIncomeOverlayCandidate(candidate)).toBe(false);
    expect(candidate?.note).toContain('direction unclear');
  });

  it('returns null for footer only text instead of footer garbage', () => {
    expect(
      parseDirectedHostCandidate(notification(OPAY_SOURCE.packageName, 'Des:Dial *955*100# to cancel SMS Alerts'), OPAY_SOURCE),
    ).toBeNull();
  });
});

describe('toIncomeCandidate', () => {
  it('drops the merchant mirror and keeps every D1 income field', () => {
    const candidate = parseDirectedHostCandidate(notification(MMS_SOURCE.packageName, UBA_CREDIT_TEXT), MMS_SOURCE);
    expect(candidate).not.toBeNull();
    if (!candidate || !isIncomeOverlayCandidate(candidate)) throw new Error('expected an income hybrid');
    const income = toIncomeCandidate(candidate);
    expect('merchant' in income).toBe(false);
    expect(income).toMatchObject({
      sourceName: 'KINGSLEY U',
      amount: 2000,
      currency: 'NGN',
      category: 'other',
      date: RECEIVED_AT,
      note: 'Detected from Messages',
      source: 'auto_capture',
      origin: 'auto_capture',
    });
  });
});

describe('buildIncomeSaveCandidate', () => {
  const base = {
    sourceName: 'KINGSLEY U',
    amount: 2000,
    currency: 'NGN',
    category: 'other',
    date: RECEIVED_AT,
    note: 'Detected from Messages',
    source: 'auto_capture' as const,
    origin: 'auto_capture' as const,
  };

  it('ignores draft merchant and amount edits in summary view', () => {
    // Category flows from the draft in every view, mirroring the expense
    // derivation: the remembered category lookup writes into the draft, so
    // the summary shows the remembered category, never a stale guess.
    const result = buildIncomeSaveCandidate(base, { merchant: 'Changed', amount: '50', categoryId: 'salary' }, 'summary');
    expect(result).toMatchObject({ sourceName: 'KINGSLEY U', amount: 2000, category: 'salary' });
  });

  it('applies valid edits and the override category in edit view', () => {
    const result = buildIncomeSaveCandidate(base, { merchant: 'KINGSLEY UZOMA', amount: '2500', categoryId: 'salary' }, 'edit', 'salary');
    expect(result).toMatchObject({ sourceName: 'KINGSLEY UZOMA', amount: 2500, category: 'salary' });
  });

  it('falls back to the parser guess on invalid edit input', () => {
    const result = buildIncomeSaveCandidate(base, { merchant: '   ', amount: '0', categoryId: '' }, 'edit');
    expect(result).toMatchObject({ sourceName: 'KINGSLEY U', amount: 2000, category: 'other' });
  });
});

describe('buildIncomeInboxRow', () => {
  it('names the income direction in the title with the draft link', () => {
    const row = buildIncomeInboxRow('draft-1', 'KINGSLEY U', 'NGN 2,000.00', 'Messages');
    expect(row.title).toBe('Income detected: KINGSLEY U');
    expect(row.body).toBe('NGN 2,000.00 from Messages. Open to confirm, edit, or snooze.');
    expect(row.type).toBe('transaction');
    expect(JSON.parse(row.data)).toEqual({ draftId: 'draft-1' });
  });
});

describe('raiseIncomeDetectionAlert', () => {
  const income = {
    sourceName: 'KINGSLEY U',
    amount: 2000,
    currency: 'NGN',
    category: 'other',
    date: RECEIVED_AT,
    note: 'Detected from Messages',
    source: 'auto_capture' as const,
    origin: 'auto_capture' as const,
  };

  function stubDeps(posted: boolean) {
    const draftStub: DetectionDraft = {
      id: 'draft-1',
      merchant: 'KINGSLEY U',
      amount: 2000,
      currency: 'NGN',
      category: 'other',
      note: 'Detected from Messages',
      source: 'auto_capture',
      detectedAt: RECEIVED_AT,
      snoozedUntil: null,
      status: 'pending',
      notificationId: null,
      createdAt: RECEIVED_AT,
      updatedAt: RECEIVED_AT,
    };
    const inserted: DetectionInboxRow[] = [];
    const shown: DetectionAlertContent[] = [];
    return {
      inserted,
      shown,
      createDraft: vi.fn(async (input: DetectionDraftInput): Promise<DetectionDraft> => ({ ...draftStub, merchant: input.merchant })),
      linkDraftRow: vi.fn(async (draftId: string): Promise<DetectionDraft | null> => ({ ...draftStub, id: draftId })),
      insertInboxRow: vi.fn(async (row: DetectionInboxRow): Promise<void> => {
        inserted.push(row);
      }),
      showAlert: vi.fn(async (content: DetectionAlertContent): Promise<{ posted: boolean }> => {
        shown.push(content);
        return { posted };
      }),
    };
  }

  it('persists the sender draft, links the income row, and pings the device', async () => {
    const deps = stubDeps(true);
    const result = await raiseIncomeDetectionAlert(deps, income, RECEIVED_AT);
    expect(deps.createDraft).toHaveBeenCalledOnce();
    expect(deps.createDraft.mock.calls[0]?.[0]).toMatchObject({ merchant: 'KINGSLEY U', amount: 2000, currency: 'NGN' });
    expect(deps.inserted).toHaveLength(1);
    const row = deps.inserted[0];
    expect(row?.title).toBe('Income detected: KINGSLEY U');
    expect(deps.linkDraftRow).toHaveBeenCalledWith('draft-1', row?.id);
    expect(deps.shown).toHaveLength(1);
    expect(deps.shown[0]).toMatchObject({ draftId: 'draft-1', merchant: 'KINGSLEY U' });
    expect(result).toMatchObject({ inboxId: row?.id, posted: true });
  });

  it('fails loudly when the draft row link is missing', async () => {
    const base = stubDeps(true);
    const deps = { ...base, linkDraftRow: vi.fn(async (draftId: string): Promise<DetectionDraft | null> => {
      void draftId;
      return null;
    }) };
    await expect(raiseIncomeDetectionAlert(deps, income, RECEIVED_AT)).rejects.toThrow('Detection draft row link failed');
  });

  it('reads a refused ping as posted false without throwing', async () => {
    const base = stubDeps(true);
    const deps = { ...base, showAlert: vi.fn(async (content: DetectionAlertContent): Promise<{ posted: boolean }> => {
      void content;
      throw new Error('denied');
    }) };
    const result = await raiseIncomeDetectionAlert(deps, income, RECEIVED_AT);
    expect(result.posted).toBe(false);
  });
});
