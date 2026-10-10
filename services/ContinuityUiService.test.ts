import { describe, expect, it } from 'vitest';
import type { ContinuityMigrationResult } from '../data/ContinuityContracts';
import {
  describeContinuityFileReadFailure,
  describeContinuityMigration,
  shouldAdoptContinuityAccount,
} from './ContinuityUiService';

function result(overrides: Partial<ContinuityMigrationResult>): ContinuityMigrationResult {
  return {
    status: 'imported',
    totalRows: 0,
    imported: 0,
    alreadyPresent: 0,
    invalid: 0,
    unrepresentable: [],
    errors: [],
    ...overrides,
  };
}

describe('shouldAdoptContinuityAccount (DEC-32 app-init routing)', () => {
  const existing = { status: 'existing', userVersion: 0, currentVersion: 6, legacyMigrated: true } as const;
  const newUser = { status: 'new_user', userVersion: 0, currentVersion: 6 } as const;

  it('adopts an existing account that has not completed onboarding (legacy v1 upgrade)', () => {
    expect(shouldAdoptContinuityAccount(existing, false)).toBe(true);
  });

  it('leaves an already onboarded account untouched', () => {
    expect(shouldAdoptContinuityAccount(existing, true)).toBe(false);
  });

  it('leaves a genuinely empty account on the first-run onboarding path', () => {
    expect(shouldAdoptContinuityAccount(newUser, false)).toBe(false);
    expect(shouldAdoptContinuityAccount(newUser, true)).toBe(false);
  });
});

describe('describeContinuityMigration (DEC-32 file fallback outcomes)', () => {
  it('reports a clean import as success with the real row count', () => {
    const feedback = describeContinuityMigration(result({ status: 'imported', totalRows: 60, imported: 60 }));
    expect(feedback.tone).toBe('success');
    expect(feedback.title).toBe('Restored 60 transactions');
    expect(feedback.message).toContain('back in the ledger');
    expect(feedback.routeToImport).toBe(false);
  });

  it('names the unrepresentable v1 fields instead of hiding the loss', () => {
    const feedback = describeContinuityMigration(result({
      status: 'imported', totalRows: 22, imported: 22, unrepresentable: ['has_receipt_image'],
    }));
    expect(feedback.message).toContain('receipt images could not be restored');
    expect(feedback.message).not.toContain('tags');
  });

  it('flags a partially imported batch as a warning with skipped rows', () => {
    const feedback = describeContinuityMigration(result({
      status: 'partially_imported', totalRows: 60, imported: 58, invalid: 2,
    }));
    expect(feedback.tone).toBe('warning');
    expect(feedback.title).toBe('Restored 58 transactions');
    expect(feedback.message).toContain('2 rows could not be read');
  });

  it('reports an idempotent re-run as already current and writes nothing', () => {
    const feedback = describeContinuityMigration(result({ status: 'already_current', totalRows: 60, alreadyPresent: 60 }));
    expect(feedback.tone).toBe('info');
    expect(feedback.title).toBe('Already restored');
    expect(feedback.message).toContain('60 transactions from this file were already present');
    expect(feedback.message).toContain('nothing was written');
  });

  it('reports an empty v1 file without inventing rows', () => {
    const feedback = describeContinuityMigration(result({ status: 'empty' }));
    expect(feedback.tone).toBe('warning');
    expect(feedback.title).toBe('No transactions found');
  });

  it('routes a non-v1 file to the S-12 Import screen', () => {
    const feedback = describeContinuityMigration(result({ status: 'unsupported' }));
    expect(feedback.tone).toBe('error');
    expect(feedback.routeToImport).toBe(true);
    expect(feedback.message).toContain('Import');
  });

  it('reports a failed batch as nothing written', () => {
    const feedback = describeContinuityMigration(result({ status: 'failed', totalRows: 3, invalid: 3 }));
    expect(feedback.tone).toBe('error');
    expect(feedback.title).toBe('Restore did not complete');
    expect(feedback.message).toContain('nothing was written');
  });
});

describe('describeContinuityFileReadFailure', () => {
  it('returns an honest error feedback shape with no route', () => {
    const feedback = describeContinuityFileReadFailure();
    expect(feedback.tone).toBe('error');
    expect(feedback.routeToImport).toBe(false);
  });
});
