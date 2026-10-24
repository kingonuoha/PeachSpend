// The one rule for reading a money amount out of an imported file (BUG-09-15).
//
// `parseFloat("1,250.50")` is 1 and `parseFloat("2,900")` is 2, because parseFloat
// stops at the first character it cannot use. A grouped cell was therefore written
// into the user's records as its first digit, with no error and no warning, and the
// row passed the import's own validity check because 1 is a finite positive number.
// A grouped amount is a real amount and is read here as its true value instead.
//
// Why this is a separate rule from `parseBudgetInput` in ./SettingsContracts and not
// a second parser: that rule is a strict `Number()` on a value the user typed into a
// settings field, and BUG-09-04a pins its refusal of `"66,000"` (DEC-B28 keeps that
// refusal, and DEC-B44's own row text relies on it). Widening that rule would reopen
// a QA-passed behaviour, so it is left alone. What is reused here is the precedent's
// shape rather than its character set: one exported parse, a valid or refused result,
// never a partial value, and no caller re-implements it. The character set differs
// because an imported cell may legitimately be grouped.
//
// Reading rules, each chosen so a real file reads correctly:
// - A trailing group of exactly three digits is a thousands group when one separator
//   character is used throughout and that separator is either the comma this app's CSV
//   convention uses for grouping, or a separator repeated in the value so it cannot be
//   a decimal at all: `2,900` is 2900, `1,250.50` is 1250.5 and `1.250.000` is 1250000.
// - Any other trailing run is the decimal part: `1250,50` is 1250.5, `1.250,50` is
//   1250.5, and `1250.505` is 1250.505. A single dot with three digits after it stays a
//   decimal, because the export writer emits `String(amount)` and writes `12.345` for
//   12.345, which must not come back as 12345.
// - Anything else is refused: a currency symbol, a letter, a space, or a malformed
//   separator run such as `1,25,0`. Refused means the caller skips the row and says
//   so. It never means a truncated value, and it never means zero, which would be a
//   different lie about the same row.
//
// One residual ambiguity is stated rather than hidden: `12,345` is read as 12345, the
// thousands reading, because the file shape this app writes is the US-style comma CSV
// the export writer emits. A European file meaning 12.345 written with a comma would be
// read as 12345 instead, and an integer written with dot grouping and no decimal part,
// `1.250`, is read as 1.25. That trade is deliberate: the row requires `2,900` to read
// as 2900, so the comma grouping reading has to win, and the dot stays the decimal
// separator the app itself uses.

export type MoneyParse = { valid: true; value: number } | { valid: false };

const PLAIN_DIGITS = /^\d+$/;
// One separator character, a first group of one to three digits, then groups of three.
const GROUPED_DIGITS = /^\d{1,3}(?:[.,]\d{3})+$/;
const DIGITS_AND_SEPARATORS = /^[+-]?[\d.,]+$/;
// `String(number)` writes this form below 1e-6 and above 1e21, so a value the app
// itself wrote must still read rather than be refused.
const EXPONENTIAL = /^[+-]?\d+(?:\.\d+)?[eE][+-]?\d+$/;

// Returns the digits of the whole part of a decimal reading, or null when it cannot
// be read. It may carry its own thousands groups, but only one separator character,
// and never the character already read as the decimal point, so `1,25,0` is refused
// rather than guessed at.
function readWholeDigits(part: string, decimalSeparator: string): string | null {
  if (part === '') return '0';
  if (PLAIN_DIGITS.test(part)) return part;
  if (!GROUPED_DIGITS.test(part)) return null;
  const separators = new Set(part.match(/[.,]/g) ?? []);
  if (separators.size !== 1 || separators.has(decimalSeparator)) return null;
  return part.replace(/[.,]/g, '');
}

export function parseMoneyAmount(raw: string | null | undefined): MoneyParse {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return { valid: false };
  if (EXPONENTIAL.test(trimmed)) {
    const value = Number(trimmed);
    return Number.isFinite(value) ? { valid: true, value } : { valid: false };
  }
  if (!DIGITS_AND_SEPARATORS.test(trimmed)) return { valid: false };

  const negative = trimmed.startsWith('-');
  const unsigned = trimmed.replace(/^[+-]/, '');
  if (!/\d/.test(unsigned)) return { valid: false };

  const lastSeparator = Math.max(unsigned.lastIndexOf('.'), unsigned.lastIndexOf(','));
  let wholeDigits: string | null;
  let fraction = '';

  if (lastSeparator === -1) {
    wholeDigits = unsigned;
  } else {
    const separator = unsigned[lastSeparator];
    const trailing = unsigned.slice(lastSeparator + 1);
    const separators = unsigned.match(/[.,]/g) ?? [];
    // The comma groups thousands in the CSV convention this app writes, and a separator
    // repeated inside one value cannot be a decimal at all. A single dot with three
    // digits after it is therefore left as a decimal, which keeps an exported 12.345
    // reading back as 12.345 rather than as 12345.
    const isThousandsGroup = new Set(separators).size === 1
      && trailing.length === 3
      && GROUPED_DIGITS.test(unsigned)
      && (separator === ',' || separators.length > 1);
    if (isThousandsGroup) {
      wholeDigits = unsigned.replace(/[.,]/g, '');
    } else {
      fraction = trailing;
      wholeDigits = readWholeDigits(unsigned.slice(0, lastSeparator), separator);
    }
  }

  if (wholeDigits === null) return { valid: false };
  // The digits are assembled into one decimal string and converted once, so the result
  // is the nearest double to the amount rather than the sum of two rounded parts.
  const magnitude = Number(fraction ? `${wholeDigits}.${fraction}` : wholeDigits);
  if (!Number.isFinite(magnitude)) return { valid: false };
  return { valid: true, value: negative ? -magnitude : magnitude };
}
