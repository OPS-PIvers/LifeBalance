import React, { useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Upload, FileSpreadsheet, AlertTriangle } from 'lucide-react';
import { Drawer } from '@/components/ui/Drawer';
import { Button } from '@/components/ui/Button';
import Select from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { useFinance } from '@/contexts/FirebaseHouseholdContext';
import {
  parseCsv,
  detectColumns,
  mapRows,
  bestDuplicateVerdict,
  type ColumnMapping,
  type DraftImportRow,
} from '@/utils/csvImport';
import type { DuplicateVerdict } from '@/utils/transactionIdentity';
import type { Transaction } from '@/types/schema';

interface CsvImportDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Rows are committed in sequential chunks (not one giant `Promise.allSettled`)
 *  so a very large CSV doesn't fire hundreds of concurrent writes at once. */
const IMPORT_CHUNK_SIZE = 25;
const PREVIEW_ROW_COUNT = 10;

type AmountMode = 'single' | 'split';

interface PreviewRow {
  row: DraftImportRow;
  verdict: DuplicateVerdict;
}

/**
 * Settings → Data → "Import transactions (CSV)". Reuses the statement-scan
 * commit path VERBATIM (`addTransaction`, one call per row, `pending_review` +
 * `source: 'file-upload'` — see advisor-plans/21-csv-import.md Investigation
 * notes): under the verified-only balance model imported rows never touch an
 * account balance, so a bad import can't corrupt Safe-to-Spend; the user
 * reviews/categorizes/verifies each row through the normal Action Queue.
 */
const CsvImportDrawer: React.FC<CsvImportDrawerProps> = ({ isOpen, onClose }) => {
  const { addTransaction, transactions } = useFinance();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [fileName, setFileName] = useState<string | null>(null);
  const [headerRow, setHeaderRow] = useState<string[]>([]);
  const [dataRows, setDataRows] = useState<string[][]>([]);
  const [amountMode, setAmountMode] = useState<AmountMode>('single');
  const [dateCol, setDateCol] = useState<number | undefined>(undefined);
  const [descCol, setDescCol] = useState<number | undefined>(undefined);
  const [amountCol, setAmountCol] = useState<number | undefined>(undefined);
  const [debitCol, setDebitCol] = useState<number | undefined>(undefined);
  const [creditCol, setCreditCol] = useState<number | undefined>(undefined);
  const [overrides, setOverrides] = useState<Record<number, boolean>>({});
  const [isImporting, setIsImporting] = useState(false);

  const resetForNewFile = () => {
    setOverrides({});
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;

    const reader = new FileReader();
    reader.onerror = () => toast.error('Could not read that file.');
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      const parsed = parseCsv(text);
      if (parsed.length <= 1) {
        // 0 = empty file; 1 = header row only, no data rows.
        toast.error('That file has no transaction rows.');
        return;
      }
      const [header, ...body] = parsed;
      setFileName(file.name);
      setHeaderRow(header ?? []);
      setDataRows(body);

      const detected = detectColumns(header ?? []);
      setDateCol(detected.date);
      setDescCol(detected.description);
      if (detected.amount !== undefined) {
        setAmountMode('single');
        setAmountCol(detected.amount);
        setDebitCol(undefined);
        setCreditCol(undefined);
      } else if (detected.debit !== undefined || detected.credit !== undefined) {
        setAmountMode('split');
        setDebitCol(detected.debit);
        setCreditCol(detected.credit);
        setAmountCol(undefined);
      } else {
        setAmountMode('single');
        setAmountCol(undefined);
        // Clear any split-mode indices left over from a previous file so they
        // can't leak stale column positions into single-mode mapping.
        setDebitCol(undefined);
        setCreditCol(undefined);
      }
      resetForNewFile();
    };
    reader.readAsText(file);
  };

  const mapping: ColumnMapping = useMemo(
    () =>
      amountMode === 'single'
        ? { date: dateCol, description: descCol, amount: amountCol }
        : { date: dateCol, description: descCol, debit: debitCol, credit: creditCol },
    [amountMode, dateCol, descCol, amountCol, debitCol, creditCol]
  );

  const mapResult = useMemo(() => mapRows(dataRows, mapping), [dataRows, mapping]);

  // Dedup pass: compare every parsed row against the household's LIVE
  // transaction window via the shared `isLikelyDuplicate` vocabulary (the same
  // primitive Plaid sync / quickAdd use), rather than inventing a parallel
  // duplicate-detection mechanism. CSV rows are never account-tagged in v1, so
  // per `isLikelyDuplicate`'s policy the strongest verdict they can earn is
  // 'possible' (never the auto-merge-safe 'duplicate') — both tiers still
  // default to skipped-with-override below.
  const existingIdentities = useMemo(() => transactions.map(draftRowIdentity_fromTransaction), [transactions]);

  const previewRows: PreviewRow[] = useMemo(
    () =>
      mapResult.ok.map(row => ({
        row,
        verdict: bestDuplicateVerdict(row, existingIdentities),
      })),
    [mapResult.ok, existingIdentities]
  );

  const defaultSelected = (verdict: DuplicateVerdict) => verdict === 'distinct';
  const isSelected = (index: number, verdict: DuplicateVerdict) =>
    overrides[index] ?? defaultSelected(verdict);

  const selectedCount = previewRows.reduce(
    (count, { verdict }, index) => count + (isSelected(index, verdict) ? 1 : 0),
    0
  );
  const flaggedCount = previewRows.filter(r => r.verdict !== 'distinct').length;

  const toggleRow = (index: number, verdict: DuplicateVerdict) => {
    setOverrides(prev => ({ ...prev, [index]: !isSelected(index, verdict) }));
  };

  const handleMappingChange = <T,>(setter: React.Dispatch<React.SetStateAction<T>>, value: T) => {
    setter(value);
    setOverrides({});
  };

  const handleClose = () => {
    setFileName(null);
    setHeaderRow([]);
    setDataRows([]);
    setOverrides({});
    setIsImporting(false);
    onClose();
  };

  const handleImport = async () => {
    const selectedRows = previewRows.filter((r, i) => isSelected(i, r.verdict)).map(r => r.row);
    if (selectedRows.length === 0) {
      toast.error('Select at least one row to import');
      return;
    }

    setIsImporting(true);
    let succeeded = 0;
    let failed = 0;
    for (let i = 0; i < selectedRows.length; i += IMPORT_CHUNK_SIZE) {
      const chunk = selectedRows.slice(i, i + IMPORT_CHUNK_SIZE);
      const results = await Promise.allSettled(
        chunk.map(row => {
          const newTransaction: Omit<Transaction, 'id' | 'createdAt' | 'payPeriodId' | 'createdBy'> = {
            amount: row.amount,
            merchant: row.merchant,
            category: row.category,
            date: row.date,
            status: 'pending_review',
            isRecurring: false,
            source: 'file-upload',
            autoCategorized: true,
          };
          return addTransaction(newTransaction);
        })
      );
      for (const r of results) {
        if (r.status === 'fulfilled') {
          succeeded += 1;
        } else {
          failed += 1;
          // Surface the cause for debugging import failures (Firestore
          // permission/validation errors) instead of swallowing it.
          console.error('CSV import: a row failed to save', r.reason);
        }
      }
    }
    setIsImporting(false);

    const skipped = previewRows.length - selectedRows.length;
    const parts = [`${succeeded} imported`];
    if (skipped > 0) parts.push(`${skipped} skipped`);
    if (mapResult.errors.length > 0) parts.push(`${mapResult.errors.length} row error(s)`);
    if (failed > 0) parts.push(`${failed} failed to save`);
    if (succeeded > 0) toast.success(`${parts.join(', ')}. Check your Action Queue.`);
    else toast.error('No transactions were imported');

    if (succeeded > 0) handleClose();
  };

  const columnOptions = () => (
    <>
      <option value="">— Select column —</option>
      {headerRow.map((h, idx) => (
        <option key={idx} value={String(idx)}>
          {h.trim() || `Column ${idx + 1}`}
        </option>
      ))}
    </>
  );

  const parseIndex = (value: string): number | undefined => (value === '' ? undefined : Number(value));
  const selectValue = (col: number | undefined): string => (col === undefined ? '' : String(col));

  return (
    <Drawer isOpen={isOpen} onClose={handleClose} title="Import transactions (CSV)" height="tall">
      <div className="space-y-5">
        {!fileName ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <div className="w-14 h-14 rounded-full bg-accent-50 dark:bg-accent-500/15 flex items-center justify-center">
              <FileSpreadsheet size={26} className="text-accent-600 dark:text-accent-300" />
            </div>
            <p className="text-sm text-brand-500 dark:text-brand-400 max-w-xs">
              Upload a CSV exported from your bank, YNAB, or Mint. Imported rows land in your Action Queue as
              pending review — nothing affects your balance until you verify each one.
            </p>
            <Button variant="primary" leftIcon={<Upload size={18} />} onClick={() => fileInputRef.current?.click()}>
              Choose CSV file
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-brand-900 dark:text-brand-100 truncate">{fileName}</p>
              <button
                type="button"
                className="shrink-0 text-xs font-semibold text-accent-600 dark:text-accent-300 hover:underline"
                onClick={() => fileInputRef.current?.click()}
              >
                Change file
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>

            <div className="space-y-3">
              <Select
                label="Date column"
                value={selectValue(dateCol)}
                onChange={e => handleMappingChange(setDateCol, parseIndex(e.target.value))}
              >
                {columnOptions()}
              </Select>

              <Select
                label="Description column"
                value={selectValue(descCol)}
                onChange={e => handleMappingChange(setDescCol, parseIndex(e.target.value))}
              >
                {columnOptions()}
              </Select>

              <div>
                <span className="text-xs font-semibold text-brand-500 dark:text-brand-400 uppercase tracking-wider block mb-1.5">
                  Amount format
                </span>
                <SegmentedControl
                  name="Amount format"
                  value={amountMode}
                  onChange={v => handleMappingChange(setAmountMode, v)}
                  options={[
                    { value: 'single', label: 'One amount column' },
                    { value: 'split', label: 'Separate debit/credit' },
                  ]}
                />
              </div>

              {amountMode === 'single' ? (
                <Select
                  label="Amount column"
                  value={selectValue(amountCol)}
                  onChange={e => handleMappingChange(setAmountCol, parseIndex(e.target.value))}
                >
                  {columnOptions()}
                </Select>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <Select
                    label="Debit column"
                    value={selectValue(debitCol)}
                    onChange={e => handleMappingChange(setDebitCol, parseIndex(e.target.value))}
                  >
                    {columnOptions()}
                  </Select>
                  <Select
                    label="Credit column"
                    value={selectValue(creditCol)}
                    onChange={e => handleMappingChange(setCreditCol, parseIndex(e.target.value))}
                  >
                    {columnOptions()}
                  </Select>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs text-brand-500 dark:text-brand-400">
              <span>{mapResult.ok.length} row(s) parsed</span>
              {mapResult.errors.length > 0 && (
                <Badge variant="danger" size="sm">
                  {mapResult.errors.length} error(s)
                </Badge>
              )}
              {flaggedCount > 0 && (
                <Badge variant="warning" size="sm">
                  {flaggedCount} possible duplicate(s)
                </Badge>
              )}
            </div>

            {previewRows.length > 0 && (
              <div className="overflow-x-auto -mx-4 px-4">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-brand-500 dark:text-brand-400">
                      <th className="py-1.5 pr-2 font-semibold">Include</th>
                      <th className="py-1.5 pr-2 font-semibold">Date</th>
                      <th className="py-1.5 pr-2 font-semibold">Description</th>
                      <th className="py-1.5 pr-2 font-semibold text-right">Amount</th>
                      <th className="py-1.5 font-semibold" />
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.slice(0, PREVIEW_ROW_COUNT).map(({ row, verdict }, index) => (
                      <tr key={index} className="border-t border-brand-100 dark:border-brand-700">
                        <td className="py-1.5 pr-2">
                          <input
                            type="checkbox"
                            checked={isSelected(index, verdict)}
                            onChange={() => toggleRow(index, verdict)}
                            aria-label={`Include ${row.merchant} on ${row.date}`}
                          />
                        </td>
                        <td className="py-1.5 pr-2 whitespace-nowrap text-brand-700 dark:text-brand-200">
                          {row.date}
                        </td>
                        <td className="py-1.5 pr-2 truncate max-w-[10rem] text-brand-900 dark:text-brand-100">
                          {row.merchant}
                        </td>
                        <td className="py-1.5 pr-2 text-right font-mono tabular-nums text-brand-900 dark:text-brand-100">
                          ${row.amount.toFixed(2)}
                        </td>
                        <td className="py-1.5">
                          {verdict !== 'distinct' && (
                            <span
                              className="inline-flex items-center gap-1 text-warm-600 dark:text-warm-300"
                              title="Looks like it might already exist"
                            >
                              <AlertTriangle size={12} />
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {previewRows.length > PREVIEW_ROW_COUNT && (
                  <p className="text-xs text-brand-500 dark:text-brand-400 mt-2">
                    + {previewRows.length - PREVIEW_ROW_COUNT} more row(s) not shown
                  </p>
                )}
              </div>
            )}

            {mapResult.errors.length > 0 && (
              <p className="text-xs text-money-neg dark:text-money-negDark">
                {mapResult.errors.length} row(s) couldn&apos;t be parsed (bad date/amount) and will be skipped.
              </p>
            )}

            <Button
              variant="primary"
              className="w-full"
              onClick={handleImport}
              isLoading={isImporting}
              disabled={selectedCount === 0 || isImporting}
            >
              Import {selectedCount} transaction{selectedCount === 1 ? '' : 's'}
            </Button>
          </>
        )}
      </div>
    </Drawer>
  );
};

/** Adapts a live `Transaction` to the shape `bestDuplicateVerdict` compares against. */
function draftRowIdentity_fromTransaction(tx: Transaction) {
  return {
    amount: tx.amount,
    merchant: tx.merchant,
    date: tx.date,
    category: tx.category,
    status: tx.status,
    accountId: tx.accountId,
    needsAmount: tx.needsAmount,
  };
}

export default CsvImportDrawer;
