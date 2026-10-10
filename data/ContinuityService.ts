import { parseCsvRows } from './csv';
import { migrations } from './migrations';
import {
  V1_EXPORT_REQUIRED_COLUMNS,
  type ContinuityAccountState,
  type ContinuityDetection,
  type ContinuityFileInput,
  type ContinuityImportPort,
  type ContinuityMigrationResult,
  type ContinuityMigrationStatus,
  type ContinuityRowMatch,
  type ContinuitySchemaPort,
  type ContinuitySchemaState,
  type ContinuityUnrepresentableField,
  type V1ExportColumn,
} from './ContinuityContracts';

// The schema version the migration runner targets. Derived from the migration
// list so a new migration cannot leave detection stale.
export const CURRENT_SCHEMA_VERSION = migrations.reduce((max, migration) => Math.max(max, migration.version), 0);

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

// Classifies an opened database from its migration version and its tables.
//
// Any written user_version means the v2 migration runner already owns the file
// (an older v2 install is caught up by the runner, and a current one is a no-op).
// An unversioned file (user_version 0) with the legacy expenses table is a v1
// install, because v1 had no migration system and never set user_version. No
// expenses table and no version is a fresh, empty account.
export function classifyContinuitySchema(userVersion: number, hasExpensesTable: boolean): ContinuitySchemaState {
  if (userVersion > 0) return 'v2';
  return hasExpensesTable ? 'v1' : 'none';
}

export async function readContinuitySchema(port: ContinuitySchemaPort): Promise<{ schema: ContinuitySchemaState; userVersion: number }> {
  const versionRow = await port.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const userVersion = versionRow?.user_version ?? 0;
  const tables = await port.getAllAsync<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'expenses'");
  return { schema: classifyContinuitySchema(userVersion, tables.length > 0), userVersion };
}

export function resolveContinuityAccountState(detection: ContinuityDetection): ContinuityAccountState {
  if (detection.hasRecords) {
    return {
      status: 'existing',
      userVersion: detection.userVersion,
      currentVersion: detection.currentVersion,
      legacyMigrated: detection.schema === 'v1',
    };
  }
  return { status: 'new_user', userVersion: detection.userVersion, currentVersion: detection.currentVersion };
}

// A v1 row mapped to v2 values, plus the file-local bookkeeping needed to make a
// re-run idempotent when the file itself contains identical rows. `occurrence` is
// the zero-based index of this row among rows with the same `signature`.
export interface ContinuityCandidate extends ContinuityRowMatch {
  occurrence: number;
  signature: string;
}

export interface ContinuityParseResult {
  recognized: boolean;
  candidates: ContinuityCandidate[];
  invalid: number;
  unrepresentable: ContinuityUnrepresentableField[];
  errors: string[];
}

function unrecognized(errors: string[]): ContinuityParseResult {
  return { recognized: false, candidates: [], invalid: 0, unrepresentable: [], errors };
}

// Parses the v1 date string as UTC midnight, the same instant the v1 export
// derived its date string from, so an import followed by a re-export reproduces
// the original date. Returns null for anything that is not a real YYYY-MM-DD
// date, rather than defaulting to today.
function parseV1Date(value: string): number | null {
  const match = DATE_PATTERN.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const ms = Date.UTC(year, month - 1, day);
  const date = new Date(ms);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return ms;
}

// Production v1 export to v2 field mapping. Values are preserved verbatim where
// v2 can hold them; a field v2 cannot hold is reported instead of dropped in
// silence. Invalid rows are counted and reported with a field code, never
// repaired with a default.
export function mapV1Export(content: string): ContinuityParseResult {
  const rows = parseCsvRows(content);
  if (rows.length === 0) return unrecognized(['empty_file']);

  const header = rows[0].map(cell => cell.trim().toLowerCase());
  const columnIndex = (name: V1ExportColumn): number => header.indexOf(name);
  if (V1_EXPORT_REQUIRED_COLUMNS.some(name => columnIndex(name) === -1)) return unrecognized(['unsupported_header']);

  const cell = (cells: string[], name: V1ExportColumn): string => {
    const index = columnIndex(name);
    return index === -1 ? '' : cells[index] ?? '';
  };

  const candidates: ContinuityCandidate[] = [];
  const errors: string[] = [];
  const unrepresentable = new Set<ContinuityUnrepresentableField>();
  const occurrenceBySignature = new Map<string, number>();
  let invalid = 0;

  for (let index = 1; index < rows.length; index++) {
    const cells = rows[index];
    const rowNumber = index;
    const merchant = cell(cells, 'merchant');
    const amountRaw = cell(cells, 'amount').trim();
    const amount = Number(amountRaw);
    const currency = cell(cells, 'currency').trim().toUpperCase();
    const category = cell(cells, 'category').trim();
    const note = cell(cells, 'note');
    const date = parseV1Date(cell(cells, 'date'));

    if (!merchant.trim()) { errors.push(`row ${rowNumber}: merchant`); invalid += 1; continue; }
    if (!amountRaw || !Number.isFinite(amount) || amount <= 0) { errors.push(`row ${rowNumber}: amount`); invalid += 1; continue; }
    if (!currency) { errors.push(`row ${rowNumber}: currency`); invalid += 1; continue; }
    if (!category) { errors.push(`row ${rowNumber}: category`); invalid += 1; continue; }
    if (date === null) { errors.push(`row ${rowNumber}: date`); invalid += 1; continue; }

    const scanned: 0 | 1 = cell(cells, 'scanned').trim() === '1' ? 1 : 0;
    if (cell(cells, 'tags').trim()) unrepresentable.add('tags');
    if (cell(cells, 'has_receipt_image').trim().toLowerCase() === 'yes') unrepresentable.add('has_receipt_image');

    const signature = JSON.stringify([date, merchant, amount, currency, category, note, scanned]);
    const occurrence = occurrenceBySignature.get(signature) ?? 0;
    occurrenceBySignature.set(signature, occurrence + 1);

    candidates.push({ merchant, amount, currency, category, note, scanned, date, occurrence, signature });
  }

  return { recognized: true, candidates, invalid, unrepresentable: [...unrepresentable], errors };
}

// Moves a v1 export into the v2 schema through the shared capture save boundary.
// The whole batch runs in one transaction, so a failure part way through rolls
// everything back instead of leaving a half-migrated account. Idempotency comes
// from counting matching imported rows already present: re-running the same file
// writes nothing, while two genuinely distinct v1 rows are both kept.
//
// The S-12 duplicate gate is deliberately not reused here. It excludes a row when
// merchant, amount, and date match within 24 hours, which would drop distinct v1
// rows that legitimately share those three fields (the real export contains such
// groups). Continuity keeps every distinct row and gets idempotency from the
// existing-row count instead. The shared save boundary, category provisioning,
// and CSV reader below are the S-12 path's own building blocks.
export async function runV1ExportMigration(port: ContinuityImportPort, input: ContinuityFileInput): Promise<ContinuityMigrationResult> {
  const parsed = mapV1Export(input.content);
  if (!parsed.recognized) {
    return { status: 'unsupported', totalRows: 0, imported: 0, alreadyPresent: 0, invalid: 0, unrepresentable: [], errors: parsed.errors };
  }

  const totalRows = parsed.candidates.length + parsed.invalid;
  const base = { totalRows, invalid: parsed.invalid, unrepresentable: parsed.unrepresentable };
  if (totalRows === 0) {
    return { status: 'empty', imported: 0, alreadyPresent: 0, ...base, errors: parsed.errors };
  }

  const categories = [...new Set(parsed.candidates.map(candidate => candidate.category))];
  let imported = 0;
  let alreadyPresent = 0;

  try {
    await port.withTransaction(async () => {
      await port.ensureCategories(categories);
      for (const candidate of parsed.candidates) {
        const existing = await port.countExisting(candidate);
        if (existing > candidate.occurrence) { alreadyPresent += 1; continue; }
        await port.saveRow(candidate);
        imported += 1;
      }
    });
  } catch {
    return { status: 'failed', imported: 0, alreadyPresent: 0, ...base, errors: [...parsed.errors, 'migration_save_failed'] };
  }

  const status: ContinuityMigrationStatus =
    imported > 0
      ? (parsed.invalid > 0 ? 'partially_imported' : 'imported')
      : parsed.invalid > 0
        ? 'failed'
        : 'already_current';

  return { status, imported, alreadyPresent, ...base, errors: parsed.errors };
}
