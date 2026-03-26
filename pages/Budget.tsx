import React, { useState } from 'react';
import BudgetCalendar from '../components/budget/BudgetCalendar';
import BudgetBuckets from '../components/budget/BudgetBuckets';
import BudgetAccounts from '../components/budget/BudgetAccounts';
import TransactionMasterList from '../components/budget/TransactionMasterList';
import BudgetHistory from '../components/budget/BudgetHistory';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs';
import Select from '@/components/ui/Select';

const TABS = [
  { value: 'calendar', label: 'Calendar' },
  { value: 'buckets', label: 'Buckets' },
  { value: 'accounts', label: 'Accounts' },
  { value: 'transactions', label: 'Transactions' },
  { value: 'history', label: 'History' },
];

const Budget: React.FC = () => {
  const [activeTab, setActiveTab] = useState(TABS[0].value);

  return (
    <div className="min-h-screen bg-slate-50 pb-28 pt-6">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="px-4">
          {/* Mobile Navigation */}
          <div className="md:hidden mb-6">
            <Select
              value={activeTab}
              onChange={(e) => setActiveTab(e.target.value)}
              aria-label="Select view"
            >
              {TABS.map((tab) => (
                <option key={tab.value} value={tab.value}>
                  {tab.label}
                </option>
              ))}
            </Select>
          </div>

          {/* Desktop Navigation */}
          <TabsList className="hidden md:flex mb-6 overflow-x-auto no-scrollbar">
            {TABS.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} className="min-w-[80px]">
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* View Container */}
          <div>
            <TabsContent value="calendar">
              <BudgetCalendar />
            </TabsContent>
            <TabsContent value="buckets">
              <BudgetBuckets />
            </TabsContent>
            <TabsContent value="accounts">
              <BudgetAccounts />
            </TabsContent>
            <TabsContent value="transactions">
              <TransactionMasterList />
            </TabsContent>
            <TabsContent value="history">
              <BudgetHistory />
            </TabsContent>
          </div>
        </div>
      </Tabs>
    </div>
  );
};

export default Budget;