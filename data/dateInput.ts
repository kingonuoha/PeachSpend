// The one rule for reading a date out of an imported file (BUG-09-19).
//
// `parseImportData` used to read a date with `new Date(value)` and fall back to
// `Date.now()` whenever that was not a valid date, so an imported row whose date
// could not be read was stored as if it had happened today: no error, no warning.
// That is the same class as the amount defect BUG-09-15 fixed, and it is worse in
// one way, because a wrong date moves an expense between months and can change a
// budget total, a monthly comparison and a streak. It takes the same decision: a
// value the file supplies that cannot be read refuses the row and is named in the
// report. Refused never means today, and it never means zero.
//
// Accepted, because each has one reading and is a shape a real file carries:
// - `YYYY-MM-DD`, the calendar date the export writer emits (`exportToCSV` in
//   services/DatabaseService.ts), the shape the real v1 export carries
//   (docs/peachspend_export_2026-01-01_to_2026-06-13.csv) and the shape the
//   external import prompt asks for. Read as UTC midnight, the instant the writer
//   derived the string from, with a real calendar check, so `2026-02-30` is
//   refused instead of rolling forward to March 2. `parseV1Date` in
//   ./ContinuityService reads the v1 date by the same rule.
// - `YYYY-MM-DDTHH:MM[:SS[.sss]]` with an explicit `Z` or `+HH:MM` offset, the
//   ISO 8601 date and time form, read as the instant the offset names. Every
//   arithmetic step below is done here rather than delegated to `Date.parse`, so
//   the instant is the one this file defines on every engine rather than one an
//   implementation is free to read differently.
// - Epoch milliseconds as a JSON number, the type the app's own `Expense.date`
//   and `CaptureCandidate.date` declare, so a JSON file carrying one still reads.
//   Two numeric shapes are refused rather than guessed at and are listed below.
//
// Refused, because the reading would be a guess rather than a fact:
// - `05/01/2026` and `01/02/2026`, day and month in an order the file does not
//   declare. Both readings are real dates, so the app refuses rather than picks
//   one. `2026/01/05` is refused with them, because the slash separator is not
//   ISO 8601 and its reading is not defined by a standard.
// - `Jan 5, 2026` and `2026-01-05 10:30:00`, which are not ISO 8601 and whose
//   reading ECMAScript leaves implementation defined.
// - `2026-01-05T10:30:00` and `2026-01-05T10:30`, an ISO date and time with no
//   offset. That form is read as the device's local time, so the same file names
//   a different instant on every device and the file itself does not say which.
//   The app refuses it rather than let the imported month depend on the phone
//   that ran the import. `2026-01-05T10:30:00+0100` is refused with it, because
//   ECMAScript defines the offset with a colon, so the colon-less form has no
//   standard reading.
// - `2026-1-5`, because ISO 8601 requires two digit month and day fields.
// - `2026-01` and `2026`, a partial date that does not say which day it means.
// - `20260105`, `not-a-date`, `13/45/2026`, `2026-13-05`, `2026-02-30`, and an
//   empty value.
// - A date string of digits such as `1710000000000`. Every CSV cell is a string,
//   so a bare number is not distinguishable from a malformed date there. A JSON
//   number is accepted above because its type already says what it is.
// - A JSON number whose millisecond reading falls in 1970 or earlier, which is
//   where zero, a negative value and a Unix seconds value all land. That cannot be
//   an expense date the user wrote and is the usual way a file writes "no date", so
//   reading it would store an epoch date instead. BUG-09-20: `1767571200` is
//   2026-01-05 in seconds and 1970-01-21 in milliseconds, so a seconds value used to
//   be stored as a date in the wrong year with no error. It is refused and named,
//   like every other date this module cannot read, rather than multiplied by 1000: a
//   conversion would be a second guess about a value the file never labelled, and
//   every Unix seconds value a plausible expense date can carry, around 1e9 to 2e9
//   for the years 2001 to 2033, is inside the refused range as milliseconds anyway.
// - A JSON number whose digits also read as a partial or whole compact calendar
//   date, `20260105` for example, which is both 2026-01-05 and 1970-08-23 as a
//   timestamp. Two readings are real, so it is refused rather than guessed at,
//   exactly as `05/01/2026` is.
// - A JSON number outside the range a Date can represent.

export type DateParse = { valid: true; value: number } | { valid: false };

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
// Uppercase is the ISO 8601 form. Lowercase `t` and `z` are accepted because case
// does not change which instant the value names, so a tolerant pattern cannot
// produce a wrong reading: the value either parses as that instant or is refused.
const ISO_DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?([Zz]|[+-]\d{2}:\d{2})?$/;
// `YYYY`, `YYYYMM` or `YYYYMMDD`, the compact date forms a number can also read as.
const COMPACT_DATE = /^\d{4}(?:\d{2})?(?:\d{2})?$/;
const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
// The first millisecond instant this module accepts as a date a user wrote:
// 1971-01-01T00:00:00Z. Zero, a negative value and a Unix seconds value all read as
// an instant before it, and none of them is an expense date, see the header above.
const FIRST_READABLE_INSTANT = Date.UTC(1971, 0, 1);

// A real calendar date as UTC midnight, or null. `Date.UTC` rolls an impossible
// day forward into the next month, so the result is read back and compared, which
// is how `2026-02-30` is refused rather than silently becoming March 2.
function readCalendarDate(year: number, month: number, day: number): number | null {
  const ms = Date.UTC(year, month - 1, day);
  const date = new Date(ms);
  const isRealDate =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return isRealDate ? ms : null;
}

// True when the integer also reads as a partial or whole compact calendar date, so
// it has a second real reading as a date and cannot be told apart from a timestamp.
function readsAsCompactDate(value: number): boolean {
  if (!Number.isInteger(value) || value <= 0) return false;
  const digits = String(value);
  if (!COMPACT_DATE.test(digits)) return false;
  const year = Number(digits.slice(0, 4));
  if (year < 1000) return false;
  if (digits.length === 4) return true;
  const month = Number(digits.slice(4, 6));
  if (month < 1 || month > 12) return false;
  if (digits.length === 6) return true;
  return readCalendarDate(year, month, Number(digits.slice(6, 8))) !== null;
}

// A JSON number as the Unix millisecond instant it declares. A reading before 1971,
// a compact date shape and an out of range value are refused, each for the reason
// stated in the header above. A Unix seconds value falls in the first of those, so
// it is refused rather than multiplied by 1000.
function readEpochMilliseconds(value: number): number | null {
  if (!Number.isFinite(value) || value < FIRST_READABLE_INSTANT) return null;
  if (readsAsCompactDate(value)) return null;
  return Number.isFinite(new Date(value).getTime()) ? value : null;
}

function readIsoDateTime(match: RegExpExecArray): number | null {
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const calendar = readCalendarDate(year, month, day);
  if (calendar === null) return null;

  const hours = Number(match[4]);
  const minutes = Number(match[5]);
  const seconds = match[6] === undefined ? 0 : Number(match[6]);
  // A fraction is read to milliseconds, the precision a Date holds, by keeping its
  // first three digits; `.5` is 500ms and `.123456` is 123ms.
  const milliseconds = match[7] === undefined ? 0 : Number(match[7].padEnd(3, '0').slice(0, 3));
  if (hours > 23 || minutes > 59 || seconds > 59) return null;

  const timeOfDay = hours * MS_PER_HOUR + minutes * MS_PER_MINUTE + seconds * 1000 + milliseconds;
  const offset = match[8];
  // No offset: the form names the device's local time, so the file does not fix
  // the instant. Refused rather than read, for the reason in the header.
  if (offset === undefined) return null;
  if (offset === 'Z' || offset === 'z') return calendar + timeOfDay;

  const offsetHours = Number(offset.slice(1, 3));
  const offsetMinutes = Number(offset.slice(4, 6));
  if (offsetHours > 23 || offsetMinutes > 59) return null;
  const direction = offset.startsWith('-') ? -1 : 1;
  return calendar + timeOfDay - direction * (offsetHours * MS_PER_HOUR + offsetMinutes * MS_PER_MINUTE);
}

export function parseImportDate(raw: unknown): DateParse {
  if (typeof raw === 'number') {
    const ms = readEpochMilliseconds(raw);
    return ms === null ? { valid: false } : { valid: true, value: ms };
  }
  if (typeof raw !== 'string') return { valid: false };
  const trimmed = raw.trim();

  const dateOnly = ISO_DATE.exec(trimmed);
  if (dateOnly) {
    const ms = readCalendarDate(Number(dateOnly[1]), Number(dateOnly[2]), Number(dateOnly[3]));
    return ms === null ? { valid: false } : { valid: true, value: ms };
  }

  const dateTime = ISO_DATE_TIME.exec(trimmed);
  if (!dateTime) return { valid: false };
  const instant = readIsoDateTime(dateTime);
  return instant === null ? { valid: false } : { valid: true, value: instant };
}
