import React from 'react';
import BudgetCalendar from '../components/budget/BudgetCalendar';
import BudgetBuckets from '../components/budget/BudgetBuckets';
import BudgetAccounts from '../components/budget/BudgetAccounts';
import TransactionMasterList from '../components/budget/TransactionMasterList';
import BudgetHistory from '../components/budget/BudgetHistory';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs';
import { useTabFromUrl } from '@/hooks/useTabFromUrl';

const Budget: React.FC = () => {
  const [currentTab, setTab] = useTabFromUrl('calendar');

  return (
    <div className="min-h-screen bg-slate-50 pb-28 pt-6">
      <Tabs value={currentTab} onValueChange={setTab}>
        <div className="px-4">
          {/* Sub-Navigation */}
          <TabsList className="mb-6 overflow-x-auto no-scrollbar">
            <TabsTrigger value="calendar" className="min-w-[80px]">
              Calendar
            </TabsTrigger>
            <TabsTrigger value="buckets" className="min-w-[80px]">
              Buckets
            </TabsTrigger>
            <TabsTrigger value="accounts" className="min-w-[80px]">
              Accounts
            </TabsTrigger>
            <TabsTrigger value="transactions" className="min-w-[80px]">
              Transactions
            </TabsTrigger>
            <TabsTrigger value="history" className="min-w-[80px]">
              History
            </TabsTrigger>
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
