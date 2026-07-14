/**
 * Utility functions for exporting data to files (JSON, CSV)
 */
import { getLocalDateString } from './dateHelpers';
import type {
  Household,
  HouseholdMember,
  Habit,
  Transaction,
  BudgetBucket,
  CalendarItem,
  Meal,
  ShoppingItem,
  ToDo,
  MealPlanItem,
  Challenge,
  RewardItem,
  Store
} from '@/types/schema';

/**
 * Triggers a browser download for a given content string
 */
const downloadFile = (content: string, filename: string, mimeType: string) => {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();

  // Clean up after a small delay to ensure download has started
  setTimeout(() => {
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, 100);
};

export interface ExportPayloadInput {
  householdId: string | null | undefined;
  exportedBy: string | undefined;
  household: Household | null | undefined;
  members: HouseholdMember[];
  habits: Habit[];
  transactions: Transaction[];
  buckets: BudgetBucket[];
  calendarItems: CalendarItem[];
  meals: Meal[];
  shoppingList: ShoppingItem[];
  todos: ToDo[];
  mealPlan: MealPlanItem[];
  challenges: Challenge[];
  rewards: RewardItem[];
  stores: Store[];
}

/**
 * Builds the full "Download my data" JSON backup payload. Pure function so
 * it can be unit-tested independently of the Settings page. Strips
 * sensitive/internal fields (fcmTokens, email) from members before export.
 */
export const buildExportPayload = (input: ExportPayloadInput) => {
  const safeMembers = input.members.map(m => {
    // Destructure to remove sensitive fields (prefixed with _ to suppress unused-var warnings)
    const { fcmTokens: _fcmTokens, email: _email, ...safeMember } = m;
    return safeMember;
  });

  return {
    meta: {
      exportedAt: new Date().toISOString(),
      householdId: input.householdId,
      exportedBy: input.exportedBy
    },
    household: input.household,
    members: safeMembers,
    habits: input.habits,
    transactions: input.transactions,
    buckets: input.buckets,
    calendarItems: input.calendarItems,
    meals: input.meals,
    shoppingList: input.shoppingList,
    todos: input.todos,
    mealPlan: input.mealPlan,
    challenges: input.challenges,
    rewards: input.rewards,
    stores: input.stores
  };
};

/**
 * Exports a full data object as a JSON file
 */
export const generateJsonBackup = (data: Record<string, unknown>, filenamePrefix: string = 'lifebalance-backup') => {
  const dateStr = getLocalDateString();
  const filename = `${filenamePrefix}-${dateStr}.json`;
  const content = JSON.stringify(data, null, 2);
  downloadFile(content, filename, 'application/json');
};

/**
 * Converts an array of flat objects to CSV format
 * Wraps all values in quotes for safety and escapes embedded quotes
 */
export const convertToCSV = (data: Record<string, unknown>[]): string => {
  if (data.length === 0) return '';

  // data[0] is defined: the length === 0 guard above ensures data is non-empty.
  const headers = Object.keys(data[0]!);
  const csvRows = [headers.join(',')];

  for (const row of data) {
    const values = headers.map(header => {
      const val = row[header];
      let strVal = String(val ?? '');

      // 🛡️ Sentinel Security Fix: Prevent CSV Injection
      // If value starts with =, +, -, @, or | (optionally preceded by whitespace),
      // prepend a single quote to force text interpretation.
      // Matches DDE attacks (starting with |) and standard formula injection.
      if (/^\s*[=+\-@|]/.test(strVal)) {
        strVal = "'" + strVal;
      }

      const escaped = strVal.replace(/"/g, '""'); // Escape double quotes
      return `"${escaped}"`; // Wrap in quotes
    });
    csvRows.push(values.join(','));
  }

  return csvRows.join('\n');
};

/**
 * Exports an array of objects as a CSV file
 */
export const generateCsvExport = (data: Record<string, unknown>[], filenamePrefix: string = 'export') => {
  const dateStr = getLocalDateString();
  const filename = `${filenamePrefix}-${dateStr}.csv`;
  const content = convertToCSV(data);
  downloadFile(content, filename, 'text/csv');
};

/** One flattened, spreadsheet-friendly row of the transactions CSV export (F-MONEY-10). */
export interface TransactionExportRow extends Record<string, unknown> {
  Date: string;
  Merchant: string;
  Category: string;
  Amount: number;
  Currency: string;
  Status: Transaction['status'];
  Account: string;
  Source: Transaction['source'];
  'Pay Period': string;
}

/**
 * Maps transactions to flat CSV-ready rows for the Money → Transactions export
 * (F-MONEY-10). Pure so it's unit-testable independently of the component.
 * Amount stays a raw decimal-dollar number (not a `useFormatCurrency()` string)
 * so spreadsheets can sum/filter it directly; `Currency` is a separate column,
 * defaulting to 'USD' but overridable by the household's configured currency.
 */
export const buildTransactionExportRows = (
  transactions: Transaction[],
  accountsById: Map<string, string>,
  currency: string = 'USD'
): TransactionExportRow[] =>
  transactions.map(tx => ({
    Date: tx.date,
    Merchant: tx.merchant,
    Category: tx.category,
    Amount: tx.amount,
    Currency: currency,
    Status: tx.status,
    Account: (tx.accountId && accountsById.get(tx.accountId)) || 'Unassigned',
    Source: tx.source,
    'Pay Period': tx.payPeriodId || 'N/A',
  }));
