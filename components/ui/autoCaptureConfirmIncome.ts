import { v4 as uuid } from 'uuid';
import { parseAutoCaptureDetection } from '../../data/AutoCaptureSource';
import type {
  AutoCaptureSourceDescriptor,
  CaptureCandidate,
  DetectionAlertContent,
  IncomeCandidate,
  NativeAutoCaptureNotification,
} from '../../data/contracts';
import type { DetectionDraft, DetectionDraftInput } from '../../data/DetectionDrafts';
import { sourceLabelFor, type DetectionInboxRow } from '../../services/DetectionAlertService';
import { formatCurrency } from '../../utils/currency';
import { formatRelativeDateWithTime } from '../../utils/dateFormat';

// Phase 16 M3 income draft support for the auto-capture confirm host
// (SH-NEW-a, brief section 4 item 5). Pure helpers only, no React Native
// imports, so this module stays unit testable in node. The overlay queue
// (RootAutoCaptureHost, contracts AutoCaptureEvent) remains expense typed,
// which is Data owned and outside this entry file set, so an income detection
// travels as a hybrid: every D1 income field preserved plus a merchant mirror
// (sourceName) that keeps host dedup, pending count, and ordering working
// with no second pipeline. The shared saveIncome boundary receives a pure
// IncomeCandidate rebuilt below, never the mirror.

// An expense typed candidate carrying the D1 income source name. The host
// queue reads merchant (the mirror); the confirm sheet reads sourceName.
export interface IncomeOverlayCandidate extends CaptureCandidate {
  sourceName: string;
}

export function isIncomeOverlayCandidate(candidate: CaptureCandidate): candidate is IncomeOverlayCandidate {
  if (!('sourceName' in candidate)) return false;
  const value = (candidate as { sourceName?: unknown }).sourceName;
  return typeof value === 'string' && value.trim().length > 0;
}

// Directed parse for the host pipeline. One notification yields at most one
// candidate, exactly like the legacy expense parse it replaces in the confirm
// host. Debit and ambiguous text return the D1 expense candidate unchanged;
// credit text returns the hybrid described above. Unparseable text returns
// null, so the parser keeps its ignored outcome.
export function parseDirectedHostCandidate(
  notification: NativeAutoCaptureNotification,
  source: AutoCaptureSourceDescriptor,
  userCurrency?: string | null,
): CaptureCandidate | null {
  const directed = parseAutoCaptureDetection(notification, source, userCurrency);
  if (!directed) return null;
  if (directed.kind === 'income') {
    const income = directed.candidate;
    const hybrid: IncomeOverlayCandidate = {
      merchant: income.sourceName,
      amount: income.amount,
      currency: income.currency,
      category: income.category,
      date: income.date,
      note: income.note,
      source: income.source,
      origin: income.origin,
      sourceName: income.sourceName,
    };
    return hybrid;
  }
  return directed.candidate;
}

// Rebuilds the pure D1 income candidate at the save boundary. The merchant
// mirror never reaches the ledger; only sourceName, amount, currency,
// category, date, note, source, and origin persist.
export function toIncomeCandidate(candidate: IncomeOverlayCandidate): IncomeCandidate {
  return {
    sourceName: candidate.sourceName,
    amount: candidate.amount,
    currency: candidate.currency,
    category: candidate.category,
    date: candidate.date,
    note: candidate.note,
    source: candidate.source,
    origin: candidate.origin,
  };
}

export interface IncomeSaveDraft {
  merchant: string;
  amount: string;
  categoryId: string;
}

// Income mirror of the host buildSaveCandidate derivation: the confirm label,
// the duplicate preview, and the persisted candidate all share this one
// derivation, so an edited source or amount is never silently dropped. In
// edit view with valid input the draft wins; everywhere else the parser guess
// wins. Invalid edit input falls back to the parser guess.
export function buildIncomeSaveCandidate(
  base: IncomeCandidate,
  draftState: IncomeSaveDraft,
  viewState: 'summary' | 'edit',
  overrideCategory?: string,
): IncomeCandidate {
  const parsedAmount = parseFloat(draftState.amount);
  const editedValid = draftState.merchant.trim().length > 0 && Number.isFinite(parsedAmount) && parsedAmount > 0;
  return {
    ...base,
    sourceName: viewState === 'edit' ? (draftState.merchant.trim() || base.sourceName) : base.sourceName,
    amount: viewState === 'edit' && editedValid ? parsedAmount : base.amount,
    category: overrideCategory ?? (draftState.categoryId || base.category),
  };
}

// Income wording for the persisted background path. Same row shape the S-14
// read path keys on (draftId link, transaction type), only the title names
// the direction honestly. Expense rows keep using buildDetectionInboxRow.
export function buildIncomeInboxRow(
  draftId: string,
  sourceName: string,
  amountText: string,
  sourceLabel: string,
): DetectionInboxRow {
  return {
    id: uuid(),
    title: `Income detected: ${sourceName}`,
    body: `${amountText} from ${sourceLabel}. Open to confirm, edit, or snooze.`,
    type: 'transaction',
    data: JSON.stringify({ draftId }),
  };
}

export interface IncomeRaiseDeps {
  createDraft: (input: DetectionDraftInput) => Promise<DetectionDraft>;
  linkDraftRow: (draftId: string, notificationId: string) => Promise<DetectionDraft | null>;
  insertInboxRow: (row: DetectionInboxRow) => Promise<void>;
  showAlert: (content: DetectionAlertContent) => Promise<{ posted: boolean }>;
}

export interface RaisedIncomeAlert {
  draft: DetectionDraft;
  inboxId: string;
  posted: boolean;
}

// Background income raise. Same mechanism as the expense raise (draft first
// so malformed input fails before any row exists, inbox row with the draft
// link, link checked loudly, device ping best effort), only the persisted
// draft is the D2 income shape (sender in source_name, kind income) and the
// inbox row is income worded. The M4 draft sheet confirms it through
// saveIncome; the overlay path confirms income directly through saveIncome
// with nothing persisted before the tap.
export async function raiseIncomeDetectionAlert(
  deps: IncomeRaiseDeps,
  income: IncomeCandidate,
  detectedAt: number,
): Promise<RaisedIncomeAlert> {
  const amountText = formatCurrency(income.amount, income.currency);
  const sourceLabel = sourceLabelFor({ note: income.note });
  const draft = await deps.createDraft({
    merchant: income.sourceName,
    amount: income.amount,
    currency: income.currency,
    category: income.category,
    note: income.note,
    source: 'auto_capture',
    detectedAt,
  });
  const row = buildIncomeInboxRow(draft.id, income.sourceName, amountText, sourceLabel);
  await deps.insertInboxRow(row);
  const linked = await deps.linkDraftRow(draft.id, row.id);
  if (!linked) throw new Error('Detection draft row link failed');
  let posted = false;
  try {
    posted = (
      await deps.showAlert({
        draftId: draft.id,
        merchant: income.sourceName,
        amountText,
        sourceLabel,
        timeText: formatRelativeDateWithTime(detectedAt),
      })
    ).posted;
  } catch {
    posted = false;
  }
  return { draft: linked, inboxId: row.id, posted };
}
