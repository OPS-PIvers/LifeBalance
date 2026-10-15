import { Account, BudgetBucket, CalendarItem, HalfAllocationKind, HalfPlan } from '@/types/schema';
import { roundMoney } from '@/utils/money';

/**
 * Reads a month copied out of the household's Google Sheet (select the cells,
 * copy, paste: Sheets puts tab-separated rows on the clipboard) into what the
 * pay-period sheet needs. The Sheet's layout: two side-by-side panels, one
 * per half, each with Date | Expense Name | $ columns; dated bills down the
 * top, then an "Other Expenses" block of budgets and allocations, then
 * totals. Panel 0 is the 1st half, panel 1 the 2nd.
 */

export type Panel = 0 | 1;

export interface PastedBill {
  panel: Panel;
  day: number;
  title: string;
  amount: number;
}

export interface PastedOther {
  panel: Panel;
  label: string;
  amount: number;
}

export interface ParsedSheet {
  bills: PastedBill[];
  others: PastedOther[];
}

const parseAmount = (cell: string | undefined): number | null => {
  const t = (cell ?? '').replace(/[$,\s]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
};

const parseDay = (cell: string | undefined): number | null => {
  const t = (cell ?? '').trim();
  if (!/^\d{1,2}$/.test(t)) return null;
  const day = Number(t);
  return day >= 1 && day <= 31 ? day : null;
};

/** Rows that close a panel's lists: totals, remainders and the like. */
const isTotalsRow = (name: string) => /total|remainder|proj\s*\/\s*actual/i.test(name);
const isPaycheck = (name: string) => /pay\s*check/i.test(name);

/**
 * Where each panel's Expense Name column is. From the header row when the
 * paste includes it; otherwise the columns where a text cell is most often
 * followed by an amount.
 */
function nameColumns(rows: string[][]): number[] {
  for (const row of rows) {
    const cols = row.flatMap((c, i) => (/expense\s*name/i.test(c) ? [i] : []));
    if (cols.length > 0) return cols.slice(0, 2);
  }
  const score = new Map<number, number>();
  for (const row of rows) {
    row.forEach((c, i) => {
      if (c.trim() && parseAmount(c) === null && parseDay(c) === null && parseAmount(row[i + 1]) !== null) {
        score.set(i, (score.get(i) ?? 0) + 1);
      }
    });
  }
  return [...score.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([col]) => col)
    .sort((a, b) => a - b);
}

export function parseSheetPaste(text: string): ParsedSheet {
  const rows = text.split(/\r?\n/).map(line => line.split('\t'));
  const cols = nameColumns(rows);
  const bills: PastedBill[] = [];
  const others: PastedOther[] = [];

  cols.forEach((nameCol, index) => {
    const panel: Panel = index === 0 ? 0 : 1;
    let day: number | null = null;
    let section: 'bills' | 'other' | 'done' = 'bills';
    for (const row of rows) {
      const dateCell = row[nameCol - 1] ?? '';
      const name = (row[nameCol] ?? '').trim();
      const amount = parseAmount(row[nameCol + 1]);
      if (/other\s*expenses/i.test(dateCell) || /other\s*expenses/i.test(name)) section = 'other';
      if (section === 'done' || /expense\s*name/i.test(name)) continue;
      if (name && isTotalsRow(name)) {
        if (section === 'other') section = 'done';
        continue;
      }
      if (section === 'bills') {
        day = parseDay(dateCell) ?? day;
        if (!name || isPaycheck(name) || amount === null || amount <= 0 || day === null) continue;
        bills.push({ panel, day, title: name, amount: roundMoney(amount) });
      } else if (name && !/other\s*expenses/i.test(name) && amount !== null && amount > 0) {
        others.push({ panel, label: name, amount: roundMoney(amount) });
      }
    }
  });

  return { bills, others };
}

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 3);
const sameWord = (a: string, b: string) =>
  a === b || (Math.min(a.length, b.length) >= 4 && (a.startsWith(b.slice(0, 5)) || b.startsWith(a.slice(0, 5))));
const nameKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** What an "Other Expenses" line becomes on the half's plan. */
export type OtherTarget =
  | { kind: 'bucket'; bucketId: string }
  | { kind: 'allocation'; allocation: HalfAllocationKind; accountId?: string }
  | { kind: 'skip' };

/**
 * A first guess for an Other Expenses line: a budget whose name shares a word
 * with it ("Grocery/Misc" → Groceries), the savings line, or an extra card
 * payment ("AmEx" → the AmEx card). Anything else becomes an "Other" line.
 */
export function guessOtherTarget(label: string, buckets: BudgetBucket[], accounts: Account[]): OtherTarget {
  if (/saving/i.test(label)) {
    return { kind: 'allocation', allocation: label.toLowerCase().includes('from') ? 'from-savings' : 'to-savings' };
  }
  const labelWords = words(label);
  const cards = accounts.filter(a => a.type === 'credit' && !a.archived);
  const isCard = /amex|american express|credit card|visa|mastercard|discover/i.test(label);
  if (isCard) {
    const card = cards.find(c => {
      const cw = words(c.name);
      return cw.some(w => labelWords.some(l => sameWord(w, l))) || (/amex/i.test(label) && /american express|amex/i.test(c.name));
    });
    return { kind: 'allocation', allocation: 'card-extra', ...(card ? { accountId: card.id } : {}) };
  }
  const bucket = buckets.find(b => words(b.name).some(w => labelWords.some(l => sameWord(w, l))));
  // No matching budget: still money with a job on the sheet, so it counts as
  // an "Other" line and the half's totals match the sheet until the user
  // points it at a budget (or skips it).
  return bucket ? { kind: 'bucket', bucketId: bucket.id } : { kind: 'allocation', allocation: 'other' };
}

/** A pasted bill and what LifeBalance already has for it. */
export interface BillMatch {
  bill: PastedBill;
  date: string;
  /** The app's bill for it (same name, within 3 days); undefined when new. */
  existing?: CalendarItem;
}

const dayDiff = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;

/**
 * Lines each pasted bill up with the household's own bills for the month
 * (expanded occurrences, paid ones included), by name and a date within 3
 * days (a weekend or a deferral moves a bill a little). Each existing bill
 * answers for one pasted line at most, so a bill paid twice a month stays two
 * lines.
 */
export function matchBills(bills: PastedBill[], month: string, expanded: CalendarItem[]): BillMatch[] {
  const used = new Set<string>();
  return bills.map(bill => {
    const date = `${month}-${String(bill.day).padStart(2, '0')}`;
    const existing = expanded
      .filter(i => i.type === 'expense' && !i.isDeleted && !used.has(i.id) && nameKey(i.title) === nameKey(bill.title))
      .filter(i => dayDiff(i.date, date) <= 3)
      .sort((a, b) => dayDiff(a.date, date) - dayDiff(b.date, date))[0];
    if (existing) used.add(existing.id);
    return { bill, date, existing };
  });
}

/**
 * The half's plan with the pasted Other Expenses applied: budgets set to the
 * sheet's amounts, allocation lines updated by label (or added). Lines that
 * are already checked off are left alone.
 */
export function applyOthers(
  plan: HalfPlan,
  lines: { label: string; amount: number; target: OtherTarget }[],
  newId: () => string
): HalfPlan {
  const budgets = { ...plan.budgets };
  let allocations = [...plan.allocations];
  for (const { label, amount, target } of lines) {
    if (target.kind === 'bucket') {
      budgets[target.bucketId] = amount;
    } else if (target.kind === 'allocation') {
      const same = allocations.find(a => a.kind === target.allocation && nameKey(a.label) === nameKey(label));
      if (same?.done) continue;
      allocations = same
        ? allocations.map(a => (a === same ? { ...a, amount, ...(target.accountId ? { accountId: target.accountId } : {}) } : a))
        : [...allocations, { id: newId(), kind: target.allocation, label, amount, ...(target.accountId ? { accountId: target.accountId } : {}) }];
    }
  }
  return { ...plan, budgets, allocations };
}
