
import React, { useState, useMemo } from 'react';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';
import { Search, Filter, X, Edit, Trash2, History, ArrowUpRight, ArrowDownLeft, FileText, Loader2 } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { Transaction } from '../../types/schema';
import EditTransactionModal from '../modals/EditTransactionModal';
import { Modal } from '../ui/Modal';
import toast from 'react-hot-toast';

const TransactionMasterList: React.FC = () => {
  const { transactions, deleteTransaction } = useHousehold();

  // State
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');

  // Edit Modal State
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  // Delete Confirmation State
  const [transactionToDelete, setTransactionToDelete] = useState<Transaction | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Derived State: Unique Categories
  const categories = useMemo(() => {
    const cats = new Set(transactions.map(t => t.category).filter(Boolean));
    return Array.from(cats).sort();
  }, [transactions]);

  // Derived State: Filtered & Sorted Transactions
  const filteredTransactions = useMemo(() => {
    return transactions
      .filter(tx => {
        // Search Filter (Merchant or Amount)
        const matchesSearch =
          tx.merchant.toLowerCase().includes(searchTerm.toLowerCase()) ||
          tx.amount.toString().includes(searchTerm);

        // Category Filter
        const matchesCategory = categoryFilter === 'all' || tx.category === categoryFilter;

        // Source Filter
        const matchesSource = sourceFilter === 'all' ||
          (sourceFilter === 'recurring' && tx.isRecurring) ||
          (sourceFilter === 'manual' && tx.source === 'manual') ||
          (sourceFilter === 'camera-scan' && tx.source === 'camera-scan') ||
          (sourceFilter === 'file-upload' && tx.source === 'file-upload');

        return matchesSearch && matchesCategory && matchesSource;
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [transactions, searchTerm, categoryFilter, sourceFilter]);

  // Handlers
  const handleEdit = (tx: Transaction) => {
    setEditingTransaction(tx);
    setIsEditModalOpen(true);
  };

  const confirmDelete = async () => {
    if (!transactionToDelete || isDeleting) return;

    setIsDeleting(true);
    try {
      await deleteTransaction(transactionToDelete.id);
      toast.success('Transaction deleted');
      setTransactionToDelete(null);
    } catch (error) {
      console.error('Failed to delete transaction:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      toast.error(`Failed to delete transaction: ${errorMessage}`);
    } finally {
      setIsDeleting(false);
    }
  };

  const clearFilters = () => {
    setSearchTerm('');
    setCategoryFilter('all');
    setSourceFilter('all');
  };

  const getSourceIcon = (source: string, isRecurring: boolean) => {
    if (isRecurring) return <History size={12} className="text-purple-500" />;
    if (source === 'camera-scan' || source === 'file-upload') return <FileText size={12} className="text-blue-500" />;
    return null;
  };

  const getSanitizedLabel = (name: string, action: string) => {
    // Replace all non-alphanumeric chars (except spaces) with nothing
    // Then replace multiple spaces with single space
    const sanitizedName = name.replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
    const truncatedName = sanitizedName.length > 30 ? `${sanitizedName.slice(0, 30)}...` : sanitizedName;
    return `${action} transaction from ${truncatedName}`;
  };

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Filters Card */}
      <div className="bg-white p-4 rounded-2xl border border-brand-100 shadow-sm space-y-3">
        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-400" size={18} />
          <input
            type="text"
            placeholder="Search merchant or amount..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-3 bg-brand-50 border border-brand-200 rounded-xl outline-none focus:border-brand-400 transition-colors"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-brand-400 hover:text-brand-600"
            >
              <X size={16} />
            </button>
          )}
        </div>

        {/* Filter Chips / Dropdowns */}
        <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-3 py-2 bg-brand-50 border border-brand-200 rounded-lg text-sm text-brand-700 outline-none focus:border-brand-400 min-w-[120px]"
          >
            <option value="all">All Categories</option>
            {categories.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>

          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="px-3 py-2 bg-brand-50 border border-brand-200 rounded-lg text-sm text-brand-700 outline-none focus:border-brand-400 min-w-[120px]"
          >
            <option value="all">All Sources</option>
            <option value="recurring">Recurring</option>
            <option value="manual">Manual Entry</option>
            <option value="camera-scan">Camera Scan</option>
            <option value="file-upload">File Upload</option>
          </select>

          {(categoryFilter !== 'all' || sourceFilter !== 'all') && (
            <button
              onClick={clearFilters}
              className="px-3 py-2 bg-brand-100 text-brand-600 rounded-lg text-sm font-medium hover:bg-brand-200 transition-colors whitespace-nowrap"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Transaction List */}
      <div className="space-y-2">
        {filteredTransactions.length === 0 ? (
          <div className="text-center py-10 text-brand-400">
            <Filter className="w-12 h-12 mx-auto mb-3 opacity-20" />
            <p>No transactions found matching your filters.</p>
            <button onClick={clearFilters} className="mt-2 text-brand-600 font-bold text-sm hover:underline">
              Clear all filters
            </button>
          </div>
        ) : (
          filteredTransactions.map(tx => (
            <div
              key={tx.id}
              className="bg-white p-3 rounded-xl border border-brand-100 shadow-sm flex items-center justify-between hover:border-brand-300 transition-colors group"
            >
              <div className="flex items-center gap-3 overflow-hidden">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                   tx.category === 'Income' ? 'bg-green-100 text-green-600' : 'bg-brand-100 text-brand-600'
                }`}>
                  {tx.category === 'Income' ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />}
                </div>

                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-bold text-brand-800 truncate">{tx.merchant}</p>
                    {getSourceIcon(tx.source, tx.isRecurring)}
                  </div>
                  <p className="text-xs text-brand-500 truncate flex items-center gap-1">
                    {format(parseISO(tx.date), 'MMM d, yyyy')}
                    <span className="w-1 h-1 rounded-full bg-brand-300" />
                    <span className="font-medium text-brand-600">{tx.category}</span>
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 pl-2">
                <div className="text-right">
                  <p className={`font-mono font-bold ${
                    tx.category === 'Income' ? 'text-green-600' : 'text-brand-800'
                  }`}>
                    {tx.category === 'Income' ? '+' : ''}${tx.amount.toFixed(2)}
                  </p>
                  {tx.status === 'pending_review' && (
                    <p className="text-[10px] text-amber-600 font-bold bg-amber-50 px-1.5 py-0.5 rounded-full inline-block">
                      Pending
                    </p>
                  )}
                </div>

                {/* Actions (visible on mobile, enhanced on hover for desktop) */}
                <div className="flex gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => handleEdit(tx)}
                    className="p-2 text-brand-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors"
                    aria-label={getSanitizedLabel(tx.merchant, 'Edit')}
                  >
                    <Edit size={16} />
                  </button>
                  <button
                    onClick={() => setTransactionToDelete(tx)}
                    className="p-2 text-brand-400 hover:text-money-neg hover:bg-rose-50 rounded-lg transition-colors"
                    aria-label={getSanitizedLabel(tx.merchant, 'Delete')}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Edit Modal - Conditionally Rendered */}
      {editingTransaction && (
        <EditTransactionModal
          isOpen={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
          transaction={editingTransaction}
        />
      )}

      {/* Delete Confirmation Modal */}
      {transactionToDelete && (
        <Modal
          isOpen={true}
          onClose={() => !isDeleting && setTransactionToDelete(null)}
          disableBackdropClose={isDeleting}
        >
          <div className="p-4 space-y-4">
            <h3 className="text-lg font-bold text-brand-800">Confirm Delete</h3>
            <p className="text-brand-600">
              Are you sure you want to delete the transaction from <strong>{transactionToDelete.merchant}</strong> for <strong>${transactionToDelete.amount.toFixed(2)}</strong>?
            </p>
            <p className="text-sm text-money-neg font-bold">
              This action cannot be undone.
            </p>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setTransactionToDelete(null)}
                disabled={isDeleting}
                className="flex-1 py-3 bg-brand-100 text-brand-600 font-bold rounded-xl hover:bg-brand-200 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={isDeleting}
                className="flex-1 py-3 bg-money-neg text-white font-bold rounded-xl hover:bg-red-600 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isDeleting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Trash2 size={18} />}
                <span>Delete</span>
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default TransactionMasterList;
