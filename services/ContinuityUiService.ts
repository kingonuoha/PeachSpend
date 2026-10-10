import type {
  ContinuityAccountState,
  ContinuityMigrationResult,
  ContinuityUnrepresentableField,
} from '../data/ContinuityContracts';

// DEC-32 continuity UI mapping. The data layer owns detection and migration; this
// module owns only the presentation decisions the two Mobile surfaces need:
// whether an app-init detection result should adopt an existing account instead of
// sending it through first-run setup, and how a migration outcome is described
// back to the user. Every count and loss below is a pure function of the real
// result, so no number or state is invented in a screen.

export type ContinuityFeedbackTone = 'success' | 'warning' | 'error' | 'info';

export interface ContinuityFeedback {
  tone: ContinuityFeedbackTone;
  title: string;
  message: string;
  // True when the supplied file is not a v1 export and the honest next step is
  // the S-12 Import screen, which owns every non-v1 format (ESC-07R-C2).
  routeToImport: boolean;
}

// An account that already holds records (a legacy v1 file upgraded in place, or an
// existing v2 install) must proceed into the app rather than re-run first-run
// setup. Returns true only when adoption is needed, so the caller writes the
// onboarding flag once and leaves a genuinely empty account on the onboarding path.
export function shouldAdoptContinuityAccount(
  account: ContinuityAccountState,
  onboardingComplete: boolean,
): boolean {
  return account.status === 'existing' && !onboardingComplete;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

// Fields v1 carried that v2 cannot restore. Named explicitly so the loss is
// reported, never hidden (DEC-33).
function describeUnrepresentable(fields: ContinuityUnrepresentableField[]): string {
  if (fields.length === 0) return '';
  const notes: string[] = [];
  if (fields.includes('has_receipt_image')) {
    notes.push('receipt images could not be restored because the v1 file stores no image');
  }
  if (fields.includes('tags')) {
    notes.push('tags could not be restored because this version has no tags field');
  }
  return ` Note: ${notes.join('; ')}.`;
}

export function describeContinuityMigration(result: ContinuityMigrationResult): ContinuityFeedback {
  const loss = describeUnrepresentable(result.unrepresentable);
  switch (result.status) {
    case 'imported':
      return {
        tone: 'success',
        title: `Restored ${plural(result.imported, 'transaction')}`,
        message: `Your v1 transactions are back in the ledger.${loss}`,
        routeToImport: false,
      };
    case 'partially_imported':
      return {
        tone: 'warning',
        title: `Restored ${plural(result.imported, 'transaction')}`,
        message: `${plural(result.invalid, 'row')} could not be read and were skipped. Every other row was restored.${loss}`,
        routeToImport: false,
      };
    case 'already_current':
      return {
        tone: 'info',
        title: 'Already restored',
        message: `${plural(result.alreadyPresent, 'transaction')} from this file were already present, so nothing was written.`,
        routeToImport: false,
      };
    case 'empty':
      return {
        tone: 'warning',
        title: 'No transactions found',
        message: 'That v1 file has no data rows to restore.',
        routeToImport: false,
      };
    case 'unsupported':
      return {
        tone: 'error',
        title: 'Not a PeachSpend v1 export',
        message: 'This file is not a v1 export. Use Import to bring in other CSV or JSON formats.',
        routeToImport: true,
      };
    case 'failed':
    default:
      return {
        tone: 'error',
        title: 'Restore did not complete',
        message: `${plural(result.invalid, 'row')} could not be read, so nothing was written. Check the file and try again.`,
        routeToImport: false,
      };
  }
}

// A picked file that could not be opened at all (read or picker failure). Kept
// here so the screen never hand-builds a feedback shape.
export function describeContinuityFileReadFailure(): ContinuityFeedback {
  return {
    tone: 'error',
    title: 'Could not read that file',
    message: 'The selected file could not be opened. Try choosing it again.',
    routeToImport: false,
  };
}
