
import React, { useState } from 'react';
import BudgetCalendar from '../components/budget/BudgetCalendar';
import BudgetBuckets from '../components/budget/BudgetBuckets';
import BudgetAccounts from '../components/budget/BudgetAccounts';
import TransactionMasterList from '../components/budget/TransactionMasterList';
import BudgetForecast from '../components/budget/BudgetForecast';

type Tab = 'calendar' | 'buckets' | 'accounts' | 'history' | 'forecast';

const Budget: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('calendar');

  return (
    <div className="min-h-screen bg-brand-50 pb-28 pt-4">
      <div className="px-4">
        {/* Sub-Navigation */}
        <div className="bg-brand-100 p-1 rounded-xl flex gap-1 mb-6 overflow-x-auto no-scrollbar">
          <button
            onClick={() => setActiveTab('calendar')}
            className={`flex-1 min-w-[80px] py-2 text-sm font-bold rounded-lg transition-all ${
              activeTab === 'calendar' ? 'bg-white text-brand-800 shadow-sm' : 'text-brand-500 hover:text-brand-700'
            }`}
          >
            Calendar
          </button>
          <button
            onClick={() => setActiveTab('forecast')}
            className={`flex-1 min-w-[80px] py-2 text-sm font-bold rounded-lg transition-all ${
              activeTab === 'forecast' ? 'bg-white text-brand-800 shadow-sm' : 'text-brand-500 hover:text-brand-700'
            }`}
          >
            Forecast
          </button>
          <button
            onClick={() => setActiveTab('buckets')}
            className={`flex-1 min-w-[80px] py-2 text-sm font-bold rounded-lg transition-all ${
              activeTab === 'buckets' ? 'bg-white text-brand-800 shadow-sm' : 'text-brand-500 hover:text-brand-700'
            }`}
          >
            Buckets
          </button>
          <button
            onClick={() => setActiveTab('accounts')}
            className={`flex-1 min-w-[80px] py-2 text-sm font-bold rounded-lg transition-all ${
              activeTab === 'accounts' ? 'bg-white text-brand-800 shadow-sm' : 'text-brand-500 hover:text-brand-700'
            }`}
          >
            Accounts
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`flex-1 min-w-[80px] py-2 text-sm font-bold rounded-lg transition-all ${
              activeTab === 'history' ? 'bg-white text-brand-800 shadow-sm' : 'text-brand-500 hover:text-brand-700'
            }`}
          >
            History
          </button>
        </div>

        {/* View Container */}
        <div className="animate-in fade-in duration-300">
          {activeTab === 'calendar' && <BudgetCalendar />}
          {activeTab === 'forecast' && <BudgetForecast />}
          {activeTab === 'buckets' && <BudgetBuckets />}
          {activeTab === 'accounts' && <BudgetAccounts />}
          {activeTab === 'history' && <TransactionMasterList />}
        </div>
      </div>
    </div>
  );
};

export default Budget;
