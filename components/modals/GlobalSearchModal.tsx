import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';
import { Modal } from '../ui/Modal';
import { Search, X, CreditCard, CheckSquare, ShoppingCart, Utensils, LayoutGrid, ArrowRight, Home, Settings, Wallet, PiggyBank } from 'lucide-react';
import { CURRENCY_FORMAT_OPTIONS } from '../../types/schema';
import { clsx } from 'clsx';

interface GlobalSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface SearchResult {
  id: string;
  type: 'transaction' | 'habit' | 'meal' | 'shopping' | 'bucket' | 'page' | 'account';
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  path: string;
  searchParam?: string; // e.g. "tab=transactions"
  score: number; // For sorting relevance
}

const GlobalSearchModal: React.FC<GlobalSearchModalProps> = ({ isOpen, onClose }) => {
  const navigate = useNavigate();
  const {
    transactions,
    habits,
    meals,
    shoppingList,
    buckets,
    accounts
  } = useHousehold();

  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      // Small delay to ensure modal is mounted and input is visible
      const timer = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Search Logic
  const results = useMemo(() => {
    if (!query.trim()) return [];

    const q = query.toLowerCase();
    const res: SearchResult[] = [];

    // 1. Pages / Navigation
    const pages = [
      { name: 'Dashboard', path: '/', icon: <Home size={18} /> },
      { name: 'Budget', path: '/budget', icon: <Wallet size={18} /> },
      { name: 'Habits', path: '/habits', icon: <CheckSquare size={18} /> },
      { name: 'Meals', path: '/meals', icon: <Utensils size={18} /> },
      { name: 'Shopping List', path: '/meals?tab=shopping-list', icon: <ShoppingCart size={18} /> },
      { name: 'Settings', path: '/settings', icon: <Settings size={18} /> },
    ];

    pages.forEach(page => {
      if (page.name.toLowerCase().includes(q)) {
        res.push({
          id: `page-${page.name}`,
          type: 'page',
          title: page.name,
          subtitle: 'Navigation',
          icon: page.icon,
          path: page.path,
          score: 100 // High priority
        });
      }
    });

    // 2. Buckets
    buckets.forEach(b => {
      if (b.name.toLowerCase().includes(q)) {
        res.push({
          id: `bucket-${b.id}`,
          type: 'bucket',
          title: b.name,
          subtitle: `Budget Bucket • $${b.limit.toLocaleString()}`,
          icon: <LayoutGrid size={18} className="text-blue-500" />,
          path: '/budget?tab=buckets',
          score: 80
        });
      }
    });

    // 3. Accounts
    accounts.forEach(a => {
        if (a.name.toLowerCase().includes(q)) {
            res.push({
                id: `account-${a.id}`,
                type: 'account',
                title: a.name,
                subtitle: `${a.type.charAt(0).toUpperCase() + a.type.slice(1)} • $${a.balance.toLocaleString()}`,
                icon: <PiggyBank size={18} className="text-emerald-500" />,
                path: '/budget?tab=accounts',
                score: 85
            });
        }
    });

    // 4. Habits
    habits.forEach(h => {
      if (h.title.toLowerCase().includes(q)) {
        res.push({
          id: `habit-${h.id}`,
          type: 'habit',
          title: h.title,
          subtitle: `Habit • Streak: ${h.streakDays}`,
          icon: <CheckSquare size={18} className="text-purple-500" />,
          path: '/habits?tab=track',
          score: 70
        });
      }
    });

    // 5. Meals
    if (meals) {
        meals.forEach(m => {
        if (m.name.toLowerCase().includes(q)) {
            res.push({
            id: `meal-${m.id}`,
            type: 'meal',
            title: m.name,
            subtitle: 'Meal / Recipe',
            icon: <Utensils size={18} className="text-orange-500" />,
            path: '/meals?tab=meal-plan',
            score: 60
            });
        }
        });
    }

    // 6. Shopping Items
    shoppingList.forEach(item => {
      if (item.name.toLowerCase().includes(q) && !item.isPurchased) {
        res.push({
          id: `shop-${item.id}`,
          type: 'shopping',
          title: item.name,
          subtitle: 'Shopping List',
          icon: <ShoppingCart size={18} className="text-teal-500" />,
          path: '/meals?tab=shopping-list',
          score: 50
        });
      }
    });

    // 7. Transactions (Recent 50 matches to avoid perf issues)
    let txMatches = 0;
    for (const tx of transactions) {
      if (txMatches >= 10) break; // Limit transaction results
      if (tx.merchant.toLowerCase().includes(q) || tx.amount.toString().includes(q)) {
        res.push({
          id: `tx-${tx.id}`,
          type: 'transaction',
          title: tx.merchant,
          subtitle: `${tx.date} • ${tx.category} • $${tx.amount.toLocaleString(undefined, CURRENCY_FORMAT_OPTIONS)}`,
          icon: <CreditCard size={18} className={tx.amount < 0 ? "text-red-500" : "text-green-500"} />,
          path: '/budget?tab=transactions', // Ideally we filter here
          score: 40
        });
        txMatches++;
      }
    }

    // Sort by score
    return res.sort((a, b) => b.score - a.score);
  }, [query, buckets, accounts, habits, meals, shoppingList, transactions]);

  const handleSelect = React.useCallback((result: SearchResult) => {
    navigate(result.path);
    onClose();
  }, [navigate, onClose]);

  // Keyboard Navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex(prev => (prev + 1) % results.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex(prev => (prev - 1 + results.length) % results.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (results[activeIndex]) {
          handleSelect(results[activeIndex]);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, results, activeIndex, handleSelect]);

  // Scroll active item into view
  useEffect(() => {
    if (resultsRef.current) {
        const activeElement = resultsRef.current.children[activeIndex] as HTMLElement;
        if (activeElement) {
            activeElement.scrollIntoView({ block: 'nearest' });
        }
    }
  }, [activeIndex]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      className="max-w-xl p-0 overflow-hidden bg-slate-50/90 backdrop-blur-xl"
      centerContent={false} // Top aligned
    >
      {/* Search Header */}
      <div className="relative border-b border-slate-200/50 bg-white/80 backdrop-blur-md">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search transactions, habits, buckets..."
          className="w-full pl-12 pr-12 py-5 bg-transparent text-lg text-slate-800 placeholder:text-slate-400 outline-none"
        />
        <button
            onClick={onClose}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
        >
            <span className="hidden sm:inline text-xs border border-slate-200 rounded px-1.5 py-0.5 mr-2">ESC</span>
            <X size={20} className="sm:hidden" />
        </button>
      </div>

      {/* Results List */}
      <div
        ref={resultsRef}
        className="max-h-[60vh] overflow-y-auto p-2 space-y-1"
      >
        {results.length === 0 ? (
          <div className="py-12 text-center text-slate-400">
            {query ? (
                <>
                    <p>No results found for &quot;{query}&quot;</p>
                    <p className="text-xs mt-1">Try searching for &quot;Rent&quot;, &quot;Groceries&quot;, or &quot;Budget&quot;</p>
                </>
            ) : (
                <>
                    <p>Type to search...</p>
                    <p className="text-xs mt-1">Navigate to pages, find transactions, or check habits.</p>
                </>
            )}
          </div>
        ) : (
          results.map((result, index) => (
            <div
              key={result.id}
              onClick={() => handleSelect(result)}
              onMouseEnter={() => setActiveIndex(index)}
              className={clsx(
                "flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-colors",
                index === activeIndex ? "bg-brand-50 text-brand-900" : "text-slate-700 hover:bg-slate-100"
              )}
            >
              <div className={clsx(
                "w-10 h-10 rounded-lg flex items-center justify-center bg-white shadow-sm border border-slate-100",
                index === activeIndex ? "ring-2 ring-brand-200" : ""
              )}>
                {result.icon}
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="font-semibold text-sm truncate">{result.title}</h4>
                {result.subtitle && (
                  <p className="text-xs text-slate-500 truncate">{result.subtitle}</p>
                )}
              </div>
              {index === activeIndex && (
                <ArrowRight size={16} className="text-brand-400" />
              )}
            </div>
          ))
        )}
      </div>

      {/* Footer Hint */}
      {results.length > 0 && (
        <div className="px-4 py-2 bg-slate-100/50 border-t border-slate-200/50 text-xs text-slate-400 flex justify-between">
            <span>{results.length} result{results.length !== 1 ? 's' : ''}</span>
            <span className="hidden sm:inline">Use arrow keys to navigate, Enter to select</span>
        </div>
      )}
    </Modal>
  );
};

export default GlobalSearchModal;
