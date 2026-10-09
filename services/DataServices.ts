import { databaseService } from './DatabaseService';
import { CategoryService } from '../data/CategoryService';
import { NotificationDataService } from '../data/NotificationDataService';
import { ProfileDataService } from '../data/ProfileDataService';
import { RecurringDataService } from '../data/RecurringDataService';
import type { CurrencyConversionWriter, DataStewardshipPort, SettingsPort } from '../data/SettingsContracts';
import type { ImportDataSource } from '../data/ImportContracts';

// Single wiring point for the Phase 06R typed contracts. Screens import these
// instances instead of running SQL or reaching into DatabaseService directly.
// The same DatabaseService instance satisfies every port structurally, so there
// is still exactly one writer per table.

export const settingsPort: SettingsPort = databaseService;
export const currencyConversionWriter: CurrencyConversionWriter = databaseService;
export const dataStewardshipPort: DataStewardshipPort = databaseService;
export const importDataSource: ImportDataSource = databaseService;

export const profileDataService = new ProfileDataService(databaseService);
export const categoryService = new CategoryService(databaseService);
export const recurringDataService = new RecurringDataService(databaseService);
export const notificationDataService = new NotificationDataService(databaseService);

// S-14 notification boundaries re-exported from the same single wiring point so
// the Notifications screen consumes the declared contract types rather than
// reaching into the data module. `notificationDataService` above stays the sole
// reader/writer (FR-14.1, FR-14.2); the re-export duplicates no write path.
export type {
  NotificationDestination,
  NotificationKind,
  NotificationListState,
  NotificationRecord,
} from '../data/NotificationContracts';

// SH-05c boundary re-exported here so the one shared profile-edit sheet consumes
// it from the single wiring point (FR-05.4, FR-06.3) instead of reaching into the
// data module. Still one writer: the re-export does not duplicate any write path.
export { saveProfileEdit } from '../data/ProfileDataService';
export type { ProfileEditDraft, ProfileEditResult } from '../data/ProfileContracts';

// S-06 settings, export, and stewardship boundaries re-exported from the same
// single wiring point so the settings screen consumes the typed contracts rather
// than reaching into the data module or running SQL. The DatabaseService instance
// already satisfies SettingsPort, ExportWriter does not (the screen owns the
// file/share UI per the contract), and DataStewardshipPort. No second writer.
export {
  buildSettingsSnapshot,
  updateBudget,
  buildExportPreview,
  executeExport,
  executeDataStewardship,
  buildConversionOptions,
  buildCurrencyConversionPreview,
  executeBulkCurrencyConversion,
  CLEAR_ALL_DATA_SCOPE,
} from '../data/SettingsContracts';
export type {
  SettingsSnapshot,
  BudgetUpdateResult,
  ExportPreview,
  ExportOutcome,
  ExportWriter,
  DataStewardshipResult,
  DataStewardshipAction,
  CurrencyConversionPreview,
  CurrencyConversionScope,
  CurrencyConversionOption,
  BulkConversionOutcome,
} from '../data/SettingsContracts';

// D9 media erasure facts re-exported from the single wiring point so the S-06
// dialogs render honest Clear and Reset copy from one source instead of a
// hardcoded sentence. Execution stays in DatabaseService; a screen never erases.
export {
  MEDIA_ERASURE_SCOPES,
  CLEAR_ALL_DATA_MEDIA_SCOPE,
  RESET_APP_MEDIA_SCOPE,
} from '../data/MediaErasure';
export type {
  MediaErasureScope,
  MediaErasureScopeSpec,
} from '../data/MediaErasure';

// S-16 category ownership boundaries re-exported from the same single wiring
// point so the Manage Categories screen consumes the declared contract rather
// than reaching into the data module or running SQL. categoryService above stays
// the sole writer (FR-16.2); these re-exports do not duplicate any write path.
export {
  CATEGORY_DELETION_SUPPORT,
  CATEGORY_COLOR_PALETTE,
  DEFAULT_CATEGORY_ICON,
} from '../data/CategoryContracts';
export type {
  CategoryRecord,
  CategoryMutationResult,
} from '../data/CategoryContracts';

// S-15 recurring ownership boundaries re-exported from the same single wiring
// point so the Recurring screen consumes the declared contract and the shared
// next-due rule rather than reaching into the data module or running SQL.
// recurringDataService above stays the sole writer (FR-15.1).
export { computeNextDueDate } from '../data/RecurringDataService';
export type {
  RecurrenceInterval,
  RecurringDraft,
  RecurringListState,
  RecurringMutationResult,
  RecurringRecord,
  RecurringType,
} from '../data/RecurringContracts';

// S-12 import boundaries re-exported from the same single wiring point so the
// Import screen consumes the declared contract instead of reaching into the data
// module or running SQL. `commitImportItems` stays the sole import commit path and
// `importDataSource` above is the sole parser. `getImportRepository` hands the
// screen the database-backed repository the pure contract functions require (the
// same instance `importDataSource` structurally satisfies), so no second writer
// and no screen SQL is introduced.
export {
  parseImportInput,
  prepareImportPreview,
  editImportItem,
  toggleImportItem,
  refreshImportItem,
  commitImportItems,
  resolveImportAiAvailability,
} from '../data/ImportDataService';
export { EXTERNAL_IMPORT_PROMPT } from '../data/ImportContracts';
export type {
  ImportAiAvailability,
  ImportCommitResult,
  ImportMethod,
  ImportParseState,
  ImportPreviewItem,
} from '../data/ImportContracts';
export const getImportRepository = () => databaseService.getCaptureRepository();
