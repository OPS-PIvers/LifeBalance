import React, { useState, useRef } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';
import { parseCSV, mapRowToTransaction, CSVMapping } from '../../utils/csvParser';
import { CaptureTransactionReview } from './CaptureTransactionReview';
import { ParsedTransaction } from '../../types/ui';
import { Upload, AlertCircle, X } from 'lucide-react';
import toast from 'react-hot-toast';
import Select from '../ui/Select';
import { Transaction } from '../../types/schema';

interface ImportTransactionsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type Step = 'upload' | 'map' | 'review';

export const ImportTransactionsModal: React.FC<ImportTransactionsModalProps> = ({ isOpen, onClose }) => {
  const { addTransaction, buckets, stores, accounts } = useHousehold();
  const [step, setStep] = useState<Step>('upload');
  const [csvData, setCsvData] = useState<string[][]>([]);
  const [headers, setHeaders] = useState<string[]>([]);

  // Mapping State
  const [mapping, setMapping] = useState<Partial<CSVMapping>>({});

  // Parsed Data State
  const [parsedTransactions, setParsedTransactions] = useState<ParsedTransaction[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setStep('upload');
    setCsvData([]);
    setHeaders([]);
    setMapping({});
    setParsedTransactions([]);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const parsed = parseCSV(text);
      if (parsed.length < 2) {
        toast.error('CSV file is empty or invalid');
        return;
      }
      setHeaders(parsed[0]);
      setCsvData(parsed.slice(1));

      // Auto-detect mapping
      const detectedMapping: Partial<CSVMapping> = {};
      parsed[0].forEach((header, index) => {
        const h = header.toLowerCase();
        if (h.includes('date')) detectedMapping.dateIndex = index;
        else if (h.includes('amount') || h.includes('debit') || h.includes('cost')) detectedMapping.amountIndex = index;
        else if (h.includes('description') || h.includes('merchant') || h.includes('payee') || h.includes('name')) detectedMapping.merchantIndex = index;
        else if (h.includes('category')) detectedMapping.categoryIndex = index;
      });
      setMapping(detectedMapping);
      setStep('map');
    };
    reader.readAsText(file);
    // Reset input value so same file can be selected again if needed
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleMapConfirm = () => {
    if (mapping.dateIndex === undefined || mapping.amountIndex === undefined || mapping.merchantIndex === undefined) {
      toast.error('Please map all required fields (Date, Amount, Merchant)');
      return;
    }

    const transactions: ParsedTransaction[] = [];
    csvData.forEach((row) => {
      const tx = mapRowToTransaction(row, mapping as CSVMapping);
      if (tx) {
        transactions.push({
          id: crypto.randomUUID(),
          ...tx,
          selected: true
        });
      }
    });

    if (transactions.length === 0) {
      toast.error('No valid transactions found with current mapping');
      return;
    }

    setParsedTransactions(transactions);
    setStep('review');
  };

  const handleImport = async () => {
    const selected = parsedTransactions.filter(t => t.selected);
    if (selected.length === 0) return;

    const toastId = toast.loading(`Importing ${selected.length} transactions...`);

    try {
      // Process in parallel with simple Promise.allSettled
      const results = await Promise.allSettled(selected.map(tx => {
          const newTx: Transaction = {
              id: tx.id,
              amount: tx.amount,
              merchant: tx.merchant,
              category: tx.category || 'Uncategorized',
              date: tx.date,
              status: 'pending_review',
              isRecurring: false,
              source: 'file-upload',
              autoCategorized: tx.category !== 'Uncategorized',
              relatedHabitIds: tx.relatedHabitIds,
              subBucketId: tx.subBucketId,
              store: tx.store,
              accountId: tx.accountId
          };
          return addTransaction(newTx);
      }));

      const successCount = results.filter(r => r.status === 'fulfilled').length;
      const failCount = results.filter(r => r.status === 'rejected').length;

      if (failCount > 0) {
          toast.error(`Imported ${successCount}, failed ${failCount}`, { id: toastId });
      } else {
          toast.success(`Successfully imported ${successCount} transactions`, { id: toastId });
      }
      handleClose();

    } catch (_error) {
        toast.error('Import failed', { id: toastId });
    }
  };

  const dynamicCategories = buckets.map(b => b.name);

  // Helper for title
  const getTitle = () => {
      if (step === 'upload') return 'Import Transactions';
      if (step === 'map') return 'Map Columns';
      return 'Review Import';
  };

  const safeParseInt = (val: string) => {
      const parsed = parseInt(val);
      return isNaN(parsed) ? undefined : parsed;
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose}>
      <div className="flex justify-between items-center px-6 py-4 border-b border-slate-100">
        <h3 className="font-bold text-lg text-slate-900">{getTitle()}</h3>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleClose}
          aria-label="Close modal"
          className="text-slate-400 hover:text-slate-600"
        >
          <X size={20} />
        </Button>
      </div>

      <div className="p-4 overflow-y-auto">
        {step === 'upload' && (
          <div className="flex flex-col items-center justify-center py-12 border-2 border-dashed border-slate-200 rounded-2xl bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer"
               onClick={() => fileInputRef.current?.click()}>
            <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept=".csv"
                className="hidden"
            />
            <div className="p-4 bg-brand-100 rounded-full text-brand-600 mb-4">
                <Upload size={32} />
            </div>
            <p className="font-bold text-slate-700 text-lg">Click to Upload CSV</p>
            <p className="text-slate-500 text-sm mt-2">Supports basic bank export formats</p>
          </div>
        )}

        {step === 'map' && (
            <div className="space-y-6">
                <div className="bg-brand-50 p-4 rounded-xl text-sm text-brand-800 flex items-start gap-3">
                    <AlertCircle className="shrink-0 mt-0.5" size={18} />
                    <div>
                        <p className="font-bold">Map Columns</p>
                        <p>Select which column in your CSV corresponds to each field.</p>
                    </div>
                </div>

                <div className="grid gap-4">
                    <Select
                        label="Date Column (Required)"
                        value={mapping.dateIndex?.toString() ?? ''}
                        onChange={(e) => setMapping({...mapping, dateIndex: safeParseInt(e.target.value)})}
                    >
                        <option value="" disabled>Select Column</option>
                        {headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                    </Select>

                    <Select
                        label="Amount Column (Required)"
                        value={mapping.amountIndex?.toString() ?? ''}
                        onChange={(e) => setMapping({...mapping, amountIndex: safeParseInt(e.target.value)})}
                    >
                        <option value="" disabled>Select Column</option>
                        {headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                    </Select>

                    <Select
                        label="Merchant/Description Column (Required)"
                        value={mapping.merchantIndex?.toString() ?? ''}
                        onChange={(e) => setMapping({...mapping, merchantIndex: safeParseInt(e.target.value)})}
                    >
                        <option value="" disabled>Select Column</option>
                        {headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                    </Select>

                    <Select
                        label="Category Column (Optional)"
                        value={mapping.categoryIndex?.toString() ?? ''}
                        onChange={(e) => setMapping({...mapping, categoryIndex: safeParseInt(e.target.value)})}
                    >
                        <option value="">(None)</option>
                        {headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                    </Select>
                </div>

                <div className="mt-4">
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Preview (First 3 rows)</p>
                    <div className="overflow-x-auto border rounded-xl">
                        <table className="w-full text-xs text-left">
                            <thead className="bg-slate-50 border-b">
                                <tr>
                                    {headers.map((h, i) => (
                                        <th key={i} className={`p-2 font-medium ${
                                            Object.values(mapping).includes(i) ? 'text-brand-700 bg-brand-50' : 'text-slate-500'
                                        }`}>
                                            {h}
                                            {mapping.dateIndex === i && <span className="ml-1 text-xs bg-brand-200 px-1 rounded">Date</span>}
                                            {mapping.amountIndex === i && <span className="ml-1 text-xs bg-brand-200 px-1 rounded">Amt</span>}
                                            {mapping.merchantIndex === i && <span className="ml-1 text-xs bg-brand-200 px-1 rounded">Merch</span>}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {csvData.slice(0, 3).map((row, idx) => (
                                    <tr key={idx} className="border-b last:border-0">
                                        {row.map((cell, cellIdx) => (
                                            <td key={cellIdx} className="p-2 truncate max-w-[100px]">{cell}</td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div className="flex gap-3 pt-4">
                    <Button variant="subtle" onClick={() => setStep('upload')} className="flex-1">Back</Button>
                    <Button variant="primary" onClick={handleMapConfirm} className="flex-1">Next: Review</Button>
                </div>
            </div>
        )}

        {step === 'review' && (
            <div className="space-y-4">
                <CaptureTransactionReview
                    parsedTransactions={parsedTransactions}
                    onUpdateTransaction={(id, updates) => setParsedTransactions(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t))}
                    onToggleSelection={(id) => setParsedTransactions(prev => prev.map(t => t.id === id ? { ...t, selected: !t.selected } : t))}
                    onToggleAll={() => {
                        const allSelected = parsedTransactions.every(t => t.selected);
                        setParsedTransactions(prev => prev.map(t => ({ ...t, selected: !allSelected })));
                    }}
                    onSubmit={handleImport}
                    dynamicCategories={dynamicCategories}
                    buckets={buckets}
                    stores={stores}
                    accounts={accounts}
                />
                 <Button variant="subtle" onClick={() => setStep('map')} className="w-full mt-2">Back to Mapping</Button>
            </div>
        )}
      </div>
    </Modal>
  );
};
