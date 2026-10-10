import { describe, expect, it } from 'vitest';
import { parseCsvLine, parseCsvRows } from './csv';
import {
  CURRENT_SCHEMA_VERSION,
  classifyContinuitySchema,
  mapV1Export,
  readContinuitySchema,
  resolveContinuityAccountState,
  runV1ExportMigration,
} from './ContinuityService';
import type { ContinuityDetection, ContinuitySchemaPort } from './ContinuityContracts';
import { MemoryContinuityPort } from './continuityTestPort';

// Structural unit tests. They exercise the documented 9-column v1 export format
// (see the header the v1 writer produced) with non-financial placeholder values.
// The real-export verification lives in ContinuityService.realExport.test.ts.
const HEADER = 'date,merchant,amount,currency,category,note,tags,scanned,has_receipt_image';

const row = (
  date: string,
  merchant: string,
  amount: string,
  currency: string,
  category: string,
  note: string,
  scanned: string,
  receipt: string,
  tags = '',
): string => `${date},"${merchant}",${amount},"${currency}","${category}","${note}",${tags},${scanned},${receipt}`;

const exportWith = (...rows: string[]): string => [HEADER, ...rows].join('\n');

const detection = (overrides: Partial<ContinuityDetection>): ContinuityDetection => ({
  schema: 'none', userVersion: 0, currentVersion: CURRENT_SCHEMA_VERSION, hasRecords: false, ...overrides,
});

function schemaPort(userVersion: number, tables: string[]): ContinuitySchemaPort {
  return {
    getFirstAsync: async <T>(_source: string): Promise<T | null> => ({ user_version: userVersion } as unknown as T),
    getAllAsync: async <T>(_source: string): Promise<T[]> => tables.map(name => ({ name } as unknown as T)),
  };
}

describe('shared CSV reader', () => {
  it('keeps commas inside quotes and unescapes doubled quotes', () => {
    expect(parseCsvLine('2026-01-01,"A, B",10,"NGN","other","say ""hi""",,0,no')).toEqual([
      '2026-01-01', 'A, B', '10', 'NGN', 'other', 'say "hi"', '', '0', 'no',
    ]);
    expect(parseCsvRows('a\n\nb')).toEqual([['a'], ['b']]);
  });
});

describe('v1 versus v2 schema classification', () => {
  it('treats an unversioned file with the legacy table as v1 and an empty file as none', () => {
    expect(classifyContinuitySchema(0, true)).toBe('v1');
    expect(classifyContinuitySchema(0, false)).toBe('none');
  });

  it('treats any versioned file, including an older v2, as v2 so the runner owns it', () => {
    expect(classifyContinuitySchema(CURRENT_SCHEMA_VERSION, true)).toBe('v2');
    expect(classifyContinuitySchema(3, true)).toBe('v2');
    expect(classifyContinuitySchema(CURRENT_SCHEMA_VERSION, false)).toBe('v2');
  });

  it('reads the version and table presence through the schema port', async () => {
    await expect(readContinuitySchema(schemaPort(0, ['expenses']))).resolves.toEqual({ schema: 'v1', userVersion: 0 });
    await expect(readContinuitySchema(schemaPort(0, []))).resolves.toEqual({ schema: 'none', userVersion: 0 });
    await expect(readContinuitySchema(schemaPort(6, ['expenses']))).resolves.toEqual({ schema: 'v2', userVersion: 6 });
  });
});

describe('account state resolution', () => {
  it('reports a new empty user when no records exist, even on a versioned file', () => {
    expect(resolveContinuityAccountState(detection({ schema: 'v2', userVersion: 6 }))).toEqual({
      status: 'new_user', userVersion: 6, currentVersion: CURRENT_SCHEMA_VERSION,
    });
  });

  it('reports an existing account and flags data that came from a v1 file', () => {
    expect(resolveContinuityAccountState(detection({ schema: 'v1', hasRecords: true }))).toMatchObject({
      status: 'existing', legacyMigrated: true,
    });
    expect(resolveContinuityAccountState(detection({ schema: 'v2', userVersion: 6, hasRecords: true }))).toMatchObject({
      status: 'existing', legacyMigrated: false,
    });
  });
});

describe('v1 export field mapping', () => {
  it('maps each column to its v2 type, formatting, and verbatim value', () => {
    const parsed = mapV1Export(exportWith(
      row('2026-03-09', 'Cafe, Main', '1250', 'ngn', 'Transport', 'lunch, client', '1', 'yes'),
    ));

    expect(parsed.recognized).toBe(true);
    expect(parsed.candidates).toHaveLength(1);
    expect(parsed.candidates[0]).toMatchObject({
      merchant: 'Cafe, Main',
      amount: 1250,
      currency: 'NGN',
      category: 'Transport',
      note: 'lunch, client',
      scanned: 1,
      date: Date.UTC(2026, 2, 9),
      occurrence: 0,
    });
    expect(parsed.invalid).toBe(0);
    expect(parsed.unrepresentable).toContain('has_receipt_image');
  });

  it('rejects an unrecognized header rather than guessing at columns', () => {
    expect(mapV1Export('a,b,c\n1,2,3')).toMatchObject({ recognized: false, errors: ['unsupported_header'] });
    expect(mapV1Export('')).toMatchObject({ recognized: false, errors: ['empty_file'] });
  });

  it('reports invalid rows with a field code and never repairs them with a default', () => {
    const parsed = mapV1Export(exportWith(
      row('2026-03-09', '', '10', 'NGN', 'other', '', '0', 'no'),
      row('2026-03-09', 'Valid', '0', 'NGN', 'other', '', '0', 'no'),
      row('not-a-date', 'Valid', '10', 'NGN', 'other', '', '0', 'no'),
    ));

    expect(parsed.candidates).toHaveLength(0);
    expect(parsed.invalid).toBe(3);
    expect(parsed.errors).toEqual(['row 1: merchant', 'row 2: amount', 'row 3: date']);
  });

  it('flags v1 columns that v2 cannot store', () => {
    const parsed = mapV1Export(exportWith(
      row('2026-03-09', 'Shop', '10', 'NGN', 'other', '', '0', 'no', 'tagged'),
    ));
    expect(parsed.unrepresentable).toEqual(['tags']);
  });
});

describe('v1 export migration', () => {
  const content = exportWith(
    row('2026-03-09', 'Cafe', '10', 'NGN', 'dining', 'note', '1', 'yes'),
    row('2026-03-10', 'Market', '20', 'NGN', 'groceries', '', '0', 'no'),
  );

  it('writes every recognized row and provisions its categories', async () => {
    const port = new MemoryContinuityPort();
    const result = await runV1ExportMigration(port, { content, fileName: 'v1.csv' });

    expect(result).toMatchObject({ status: 'imported', totalRows: 2, imported: 2, alreadyPresent: 0, invalid: 0 });
    expect(port.rows).toHaveLength(2);
    expect(port.categories).toEqual(['dining', 'groceries']);
  });

  it('is idempotent: a second run of the same file writes nothing', async () => {
    const port = new MemoryContinuityPort();
    await runV1ExportMigration(port, { content });
    const second = await runV1ExportMigration(port, { content });

    expect(second).toMatchObject({ status: 'already_current', imported: 0, alreadyPresent: 2 });
    expect(port.rows).toHaveLength(2);
  });

  it('keeps two genuinely identical v1 rows instead of collapsing them', async () => {
    const duplicate = row('2026-03-09', 'Cafe', '10', 'NGN', 'dining', '', '0', 'no');
    const port = new MemoryContinuityPort();
    const result = await runV1ExportMigration(port, { content: exportWith(duplicate, duplicate) });

    expect(result).toMatchObject({ status: 'imported', imported: 2 });
    expect(port.rows).toHaveLength(2);
  });

  it('rolls the whole batch back when a row cannot be written', async () => {
    const port = new MemoryContinuityPort();
    port.failSaves = true;
    const result = await runV1ExportMigration(port, { content });

    expect(result).toMatchObject({ status: 'failed', imported: 0 });
    expect(result.errors).toContain('migration_save_failed');
    expect(port.rows).toHaveLength(0);
  });

  it('reports an unsupported file, an empty file, and all-invalid input distinctly', async () => {
    const port = new MemoryContinuityPort();
    await expect(runV1ExportMigration(port, { content: 'a,b\n1,2' })).resolves.toMatchObject({ status: 'unsupported' });
    await expect(runV1ExportMigration(port, { content: HEADER })).resolves.toMatchObject({ status: 'empty', totalRows: 0 });
    await expect(runV1ExportMigration(port, { content: exportWith(row('', '', '', '', '', '', '0', 'no')) }))
      .resolves.toMatchObject({ status: 'failed', imported: 0, invalid: 1 });
  });
});
