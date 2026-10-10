import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCsvRows } from './csv';
import { mapV1Export, runV1ExportMigration } from './ContinuityService';
import { MemoryContinuityPort } from './continuityTestPort';

// Authoritative v1 continuity verification against the real v1 export supplied by
// Kingsley (docs/peachspend_export_2026-01-01_to_2026-06-13.csv). The file holds
// real financial data, is gitignored, is read in place, and is never copied into a
// tracked path. The test skips cleanly when the file is absent, so a CI checkout
// without it stays green. Only counts, codes, and field-level boolean outcomes are
// asserted and printed; no row content is printed.
const EXPORT_PATH = resolve(process.cwd(), '..', 'docs', 'peachspend_export_2026-01-01_to_2026-06-13.csv');
const hasExport = existsSync(EXPORT_PATH);

const toIsoDate = (ms: number): string => new Date(ms).toISOString().split('T')[0];

describe.skipIf(!hasExport)('v1 continuity against the real export', () => {
  const raw = hasExport ? readFileSync(EXPORT_PATH, 'utf8') : '';
  // Independent row count: non-blank lines minus the header, without the parser.
  const dataLineCount = raw.split('\n').map(line => line.trim()).filter(line => line.length > 0).length - 1;
  const rows = parseCsvRows(raw);
  const header = rows[0] ?? [];
  const dataRows = rows.slice(1);
  const column = (name: string): number => header.indexOf(name);

  it('parses every data row with no invalid rows and no field loss', () => {
    const parsed = mapV1Export(raw);
    expect(parsed.recognized).toBe(true);
    expect(parsed.invalid).toBe(0);
    expect(parsed.errors).toEqual([]);
    expect(parsed.candidates).toHaveLength(dataLineCount);
    expect(dataRows).toHaveLength(dataLineCount);

    // Per-field fidelity: every mapped value is checked against the raw cell of the
    // real row it came from. A dropped or altered field fails here.
    parsed.candidates.forEach((candidate, index) => {
      const cells = dataRows[index];
      expect(cells).toHaveLength(9);
      expect(toIsoDate(candidate.date)).toBe(cells[column('date')]);
      expect(candidate.merchant).toBe(cells[column('merchant')]);
      expect(candidate.amount).toBe(Number(cells[column('amount')]));
      expect(String(candidate.amount)).toBe(cells[column('amount')]);
      expect(candidate.currency).toBe(cells[column('currency')].trim().toUpperCase());
      expect(candidate.category).toBe(cells[column('category')]);
      expect(candidate.note).toBe(cells[column('note')]);
      expect(candidate.scanned).toBe(cells[column('scanned')] === '1' ? 1 : 0);
      expect(cells[column('tags')]).toBe('');
      expect(cells[column('has_receipt_image')]).toBe(candidate.scanned === 1 ? 'yes' : 'no');
    });
  });

  it('imports the real export into the v2 schema with an exact row count and is idempotent', async () => {
    const port = new MemoryContinuityPort();
    const result = await runV1ExportMigration(port, { content: raw, fileName: 'peachspend_export.csv' });

    expect(result.status).toBe('imported');
    expect(result.totalRows).toBe(dataLineCount);
    expect(result.imported).toBe(dataLineCount);
    expect(result.invalid).toBe(0);
    expect(result.alreadyPresent).toBe(0);
    expect(port.rows).toHaveLength(dataLineCount);
    expect(result.unrepresentable).toContain('has_receipt_image');

    // A second run of the same file writes nothing, proving idempotency.
    const second = await runV1ExportMigration(port, { content: raw });
    expect(second).toMatchObject({ status: 'already_current', imported: 0, alreadyPresent: dataLineCount });
    expect(port.rows).toHaveLength(dataLineCount);

    if (process.env.CONTINUITY_EVIDENCE === '1') {
      process.stdout.write(
        `real-export continuity: dataLines=${dataLineCount} imported=${result.imported} ` +
        `invalid=${result.invalid} secondRunAlreadyPresent=${second.alreadyPresent} ` +
        `unrepresentable=${result.unrepresentable.join('|')} categories=${port.categories.length}\n`,
      );
    }
  });
});
