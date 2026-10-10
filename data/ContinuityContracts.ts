// DEC-32 v1 to v2 continuity contracts (data layer and typed contract only, no
// screen UI). See docs/phases/phase-07-restart/data-ai-task.md for the field
// mapping this layer implements and the scope limits it records.

// The exact 9-column header the v1 export writer produced. The continuity
// migration recognizes this header and nothing else; any other shape is
// reported as `unsupported` rather than guessed at.
export const V1_EXPORT_COLUMNS = [
  'date', 'merchant', 'amount', 'currency', 'category', 'note', 'tags', 'scanned', 'has_receipt_image',
] as const;

export type V1ExportColumn = typeof V1_EXPORT_COLUMNS[number];

// Columns the mapping requires. `note`, `tags`, `scanned`, and
// `has_receipt_image` are optional in principle, but the real v1 export always
// carries all nine.
export const V1_EXPORT_REQUIRED_COLUMNS = ['date', 'merchant', 'amount', 'currency', 'category'] as const;

// A v1 column that v2 has no place for. `tags` has no v2 column at all, and
// `has_receipt_image` only records that v1 pointed at a receipt image file that
// the CSV does not carry, so the image itself cannot be restored. Rows that use
// either field are still imported; the loss is reported, never hidden.
export type ContinuityUnrepresentableField = 'tags' | 'has_receipt_image';

// Classification of the on-device database at open time, before the migration
// runner advances it. `v1` means an unversioned legacy file with the old tables,
// `v2` means a file the migration runner already owns, `none` means no data.
export type ContinuitySchemaState = 'none' | 'v1' | 'v2';

export interface ContinuityDetection {
  schema: ContinuitySchemaState;
  // PRAGMA user_version observed before the runner ran, and the version the
  // runner targets. A v1 file reports userVersion 0 and currentVersion 6.
  userVersion: number;
  currentVersion: number;
  // True when the account already holds at least one expense or income row.
  // `schema` alone cannot answer "new empty user": a reinstalled v2 app reports
  // `v2` with no records, which is still an empty account.
  hasRecords: boolean;
}

// What a first-run or Settings surface renders. `new_user` is the honest empty
// account; `existing` is a populated one; `legacyMigrated` marks data that came
// from a v1 file so the surface can say so without inventing a state.
export type ContinuityAccountState =
  | { status: 'new_user'; userVersion: number; currentVersion: number }
  | { status: 'existing'; userVersion: number; currentVersion: number; legacyMigrated: boolean };

// Outcome of moving a v1 export into the v2 schema.
// - imported: new rows written, no rejected rows.
// - partially_imported: some rows written, some rejected as invalid.
// - already_current: every row was already present, so nothing was written
//   (an idempotent re-run of the same file).
// - empty: the file was recognized but held no data rows.
// - unsupported: the file is not a v1 export (header not recognized).
// - failed: nothing was written because rows were invalid or a write failed.
export type ContinuityMigrationStatus =
  | 'imported'
  | 'partially_imported'
  | 'already_current'
  | 'empty'
  | 'unsupported'
  | 'failed';

export interface ContinuityMigrationResult {
  status: ContinuityMigrationStatus;
  // Data rows seen in the file (valid plus invalid).
  totalRows: number;
  imported: number;
  // Rows skipped because an identical imported row already exists. This is what
  // makes a second run of the same file a no-op.
  alreadyPresent: number;
  // Rows rejected because a required field was missing or unreadable.
  invalid: number;
  unrepresentable: ContinuityUnrepresentableField[];
  // Row-indexed field codes and error codes only. Never row content, never a
  // key. Safe to log and to render.
  errors: string[];
}

// Manual fallback input: the v1 file supplied from Settings. The screen owns the
// file picker; the data layer owns the bytes-to-records boundary.
export interface ContinuityFileInput {
  content: string;
  fileName?: string;
}

// The mapped v2 values for one v1 row, before persistence.
export interface ContinuityRowMatch {
  merchant: string;
  amount: number;
  currency: string;
  category: string;
  note: string;
  scanned: 0 | 1;
  // Epoch milliseconds at UTC midnight, matching how the v1 writer derived the
  // exported date string.
  date: number;
}

// Minimal schema read surface so classification is testable without SQLite. The
// real database satisfies it structurally through a two-method adapter.
export interface ContinuitySchemaPort {
  getFirstAsync<T>(source: string): Promise<T | null>;
  getAllAsync<T>(source: string): Promise<T[]>;
}

// Write surface the migration drives. It is implemented once, in
// DatabaseService, over the existing capture save boundary so continuity never
// becomes a second writer of the expenses table.
export interface ContinuityImportPort {
  ensureCategories(names: string[]): Promise<void>;
  countExisting(match: ContinuityRowMatch): Promise<number>;
  saveRow(match: ContinuityRowMatch): Promise<void>;
  withTransaction<T>(operation: () => Promise<T>): Promise<T>;
}

// The typed contract Mobile's Settings provide-file entry and first-run surface
// call. Implemented by databaseService.
export interface ContinuityContract {
  detectContinuity(): Promise<ContinuityDetection>;
  migrateV1Export(input: ContinuityFileInput): Promise<ContinuityMigrationResult>;
}
