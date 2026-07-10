/**
 * Pure CSV parsing + column mapping for the "Import transactions (CSV)" flow
 * (advisor-plans/21-csv-import.md). No React, no Firestore — data in,
 * `DraftImportRow[]` out — so it's trivially unit-testable and reusable.
 *
 * Deliberately hand-rolled (no CSV dependency): the app avoids dependency
 * creep and the RFC-4180 subset needed here (quoted fields, `""` escapes,
 * CR/LF/CRLF line endings) is small.
 *
 * `DraftImportRow.amount` is always a POSITIVE decimal-dollar magnitude,
 * matching the rest of the app's `Transaction.amount` convention (sign is
 * conveyed by `category`, not by the stored amount — see
 * `utils/accountImpact.ts`). A net-positive parsed row (income/deposit) is
 * categorized `INCOME_CATEGORY`; a net-negative or zero row is categorized
 * `UNCATEGORIZED_CATEGORY` for the user to assign during the normal
 * pending-review flow (auto-categorization of imports is out of scope).
 */
import { INCOME_CATEGORY } from '@/types/schema';
import { isLikelyDuplicate, type DuplicateVerdict, type IdentityTransaction } from '@/utils/transactionIdentity';

/** Sentinel category for imported rows the parser can't sign-classify as income. */
export const UNCATEGORIZED_CATEGORY = 'Uncategorized';

/**
 * Parse RFC-4180-lite CSV text into rows of raw string cells.
 *
 * Supports: quoted fields (`"a,b"`), escaped quotes inside a quoted field
 * (`""` → `"`), CR / LF / CRLF line endings, and skips fully blank lines
 * (a line with zero cells, or a single empty unquoted cell). Does NOT trim
 * cell whitespace (callers trim as needed) so a value like `" foo "` inside
 * quotes round-trips exactly.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  let cellStarted = false;

  const endCell = () => {
    row.push(cell);
    cell = '';
    cellStarted = false;
  };
  const endRow = () => {
    endCell();
    // Skip a fully blank line: exactly one empty, unquoted cell.
    if (!(row.length === 1 && row[0] === '')) rows.push(row);
    row = [];
  };

  let i = 0;
  const len = text.length;
  while (i < len) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && !cellStarted) {
      inQuotes = true;
      cellStarted = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      endCell();
      i += 1;
      continue;
    }
    if (ch === '\r') {
      // Consume an optional following \n so CRLF counts as one line break.
      if (text[i + 1] === '\n') i += 1;
      endRow();
      i += 1;
      continue;
    }
    if (ch === '\n') {
      endRow();
      i += 1;
      continue;
    }
    cell += ch;
    cellStarted = true;
    i += 1;
  }
  // Flush a trailing cell/row that wasn't terminated by a line break, unless
  // the text ended cleanly on a line break (nothing pending to flush).
  if (cell !== '' || cellStarted || row.length > 0) {
    endRow();
  }

  return rows;
}

/** Column indices auto-detected (or user-confirmed) from a CSV header row. */
export interface ColumnMapping {
  date?: number;
  amount?: number;
  description?: number;
  debit?: number;
  credit?: number;
}

/** Header-name dictionary — data, not code branches; extend as real bank CSVs surface. */
const HEADER_ALIASES: Record<keyof ColumnMapping, string[]> = {
  date: ['date', 'posted', 'post date', 'transaction date', 'trans date'],
  amount: ['amount', 'amt'],
  debit: ['debit', 'withdrawal', 'withdrawals', 'debit amount'],
  credit: ['credit', 'deposit', 'deposits', 'credit amount'],
  description: ['description', 'payee', 'merchant', 'memo', 'name', 'details'],
};

/**
 * Case-insensitive best-effort header-name matching for common CSV column
 * names (bank/YNAB/Mint-style exports). Returns only the columns it's
 * confident about; the caller (the drawer's mapping UI) lets the user
 * override/complete the mapping before importing.
 */
export function detectColumns(header: string[]): ColumnMapping {
  const normalized = header.map(h => h.trim().toLowerCase());
  const mapping: ColumnMapping = {};

  (Object.keys(HEADER_ALIASES) as Array<keyof ColumnMapping>).forEach(key => {
    const aliases = HEADER_ALIASES[key];
    const index = normalized.findIndex(h => aliases.includes(h));
    if (index !== -1) mapping[key] = index;
  });

  return mapping;
}

/** A single successfully-parsed CSV row, ready to become a pending `Transaction`. */
export interface DraftImportRow {
  /** Local `yyyy-MM-dd`. */
  date: string;
  /** Positive decimal-dollar magnitude (see module doc for the sign convention). */
  amount: number;
  merchant: string;
  category: string;
}

export interface MapRowsError {
  /** 1-based line number within the ORIGINAL file (header = line 1). */
  line: number;
  reason: string;
}

export interface MapRowsResult {
  ok: DraftImportRow[];
  errors: MapRowsError[];
}

/** Get a cell's raw value, or '' when the row is short (never throws). */
function cellAt(row: string[], index: number | undefined): string {
  if (index === undefined) return '';
  return row[index] ?? '';
}

/**
 * Parse a `yyyy-MM-dd` / `MM/DD/YYYY` / `M/D/YY` date cell to a local
 * `yyyy-MM-dd` string, or `null` when unparseable / not a real calendar date.
 * A 2-digit year is interpreted as 2000+YY (bank CSV exports are always recent).
 */
function parseDateCell(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;

  // ISO (year-first): accept either separator — YYYY-MM-DD or YYYY/MM/DD.
  const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(s);
  if (iso) {
    const [, y, m, d] = iso;
    return toIsoIfValid(Number(y), Number(m), Number(d));
  }

  // US (month-first): accept either separator — MM/DD/YYYY or MM-DD-YYYY.
  const us = /^(\d{1,2})[-/](\d{1,2})[-/](\d{2}|\d{4})$/.exec(s);
  if (us) {
    const [, m, d, yRaw] = us;
    const yearStr = yRaw ?? '';
    const year = yearStr.length === 2 ? 2000 + Number(yearStr) : Number(yearStr);
    return toIsoIfValid(year, Number(m), Number(d));
  }

  return null;
}

/** Build a `yyyy-MM-dd` string, but only if (y, m, d) form a real calendar date. */
function toIsoIfValid(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  // JS Date rolls invalid components over (e.g. Feb 30 → Mar 2) — reject those.
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Parse an amount cell to a SIGNED decimal number (positive = inflow/credit,
 * negative = outflow/debit). Strips `$` and thousands-commas; a
 * parentheses-wrapped value (`(123.45)`) is treated as negative. Returns
 * `null` when unparseable.
 */
function parseAmountCell(raw: string): number | null {
  let s = raw.trim();
  if (!s) return null;

  let negative = false;
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  s = s.replace(/[$,]/g, '').trim();
  if (!s) return null;

  const value = Number(s);
  if (!Number.isFinite(value)) return null;

  const signed = negative ? -Math.abs(value) : value;
  return signed;
}

/**
 * Map raw CSV data rows (header already excluded — `rows[0]` is the FIRST
 * DATA row, i.e. file line 2) into `DraftImportRow`s using a confirmed
 * `ColumnMapping`. Either `mapping.amount` (single signed/parenthesized
 * column) or both `mapping.debit`/`mapping.credit` (split columns) must be
 * supplied; `mapping.date` and `mapping.description` are required for any
 * row to be usable. Rows with an unparseable date or amount are collected
 * into `errors` rather than silently dropped or defaulted.
 */
export function mapRows(rows: string[][], mapping: ColumnMapping): MapRowsResult {
  const ok: DraftImportRow[] = [];
  const errors: MapRowsError[] = [];

  rows.forEach((row, i) => {
    const line = i + 2; // +1 for 0-index, +1 for the header row.

    const date = parseDateCell(cellAt(row, mapping.date));
    if (date === null) {
      errors.push({ line, reason: 'Unparseable or missing date' });
      return;
    }

    let signedAmount: number | null;
    if (mapping.amount !== undefined) {
      signedAmount = parseAmountCell(cellAt(row, mapping.amount));
    } else {
      const debitRaw = cellAt(row, mapping.debit).trim();
      const creditRaw = cellAt(row, mapping.credit).trim();
      const debit = debitRaw ? parseAmountCell(debitRaw) : 0;
      const credit = creditRaw ? parseAmountCell(creditRaw) : 0;
      if (debit === null || credit === null) {
        signedAmount = null;
      } else if (!debitRaw && !creditRaw) {
        signedAmount = null;
      } else {
        signedAmount = Math.abs(credit) - Math.abs(debit);
      }
    }
    if (signedAmount === null) {
      errors.push({ line, reason: 'Unparseable or missing amount' });
      return;
    }

    const merchant = cellAt(row, mapping.description).trim() || 'Imported transaction';
    const category = signedAmount > 0 ? INCOME_CATEGORY : UNCATEGORIZED_CATEGORY;

    ok.push({
      date,
      amount: Math.abs(signedAmount),
      merchant,
      category,
    });
  });

  return { ok, errors };
}

/** A parsed row's shape for the shared `isLikelyDuplicate` identity check — always `pending_review` (imported rows never land `verified`). */
export function draftRowIdentity(row: DraftImportRow): IdentityTransaction {
  return {
    amount: row.amount,
    merchant: row.merchant,
    date: row.date,
    category: row.category,
    status: 'pending_review',
  };
}

/**
 * The most confident `isLikelyDuplicate` verdict for `row` against any of
 * `existing` (the household's live transaction window). `'duplicate'` short-
 * circuits (nothing beats it); otherwise the strongest signal seen — `'possible'`
 * over `'distinct'` — wins, so one plausible match is enough to flag the row
 * even if it's `'distinct'` from everything else.
 */
export function bestDuplicateVerdict(
  row: DraftImportRow,
  existing: readonly IdentityTransaction[]
): DuplicateVerdict {
  const rowIdentity = draftRowIdentity(row);
  let best: DuplicateVerdict = 'distinct';
  for (const tx of existing) {
    const verdict = isLikelyDuplicate(rowIdentity, tx);
    if (verdict === 'duplicate') return 'duplicate';
    if (verdict === 'possible') best = 'possible';
  }
  return best;
}
