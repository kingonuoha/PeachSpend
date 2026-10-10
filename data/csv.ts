// Single CSV reader for the export/import boundary and the v1 continuity
// migration. The v1 export writer wrote this format and both readers consume it,
// so the quote handling lives here once instead of in each parser.
//
// Supported: quoted fields, doubled quotes inside a quoted field, and commas
// inside quotes. Not supported: embedded newlines. Neither the export writer nor
// the v1 export format emits them, so a row is always one line.

export function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// Splits raw file content into parsed cell rows. Blank lines are dropped so a
// trailing newline never becomes a phantom data row.
export function parseCsvRows(content: string): string[][] {
  return content
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(parseCsvLine);
}
