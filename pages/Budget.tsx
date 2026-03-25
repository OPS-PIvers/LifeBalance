
import React from 'react';
import BudgetCalendar from '../components/budget/BudgetCalendar';
import BudgetBuckets from '../components/budget/BudgetBuckets';
import BudgetAccounts from '../components/budget/BudgetAccounts';
import TransactionMasterList from '../components/budget/TransactionMasterList';
import BudgetHistory from '../components/budget/BudgetHistory';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs';

const Budget: React.FC = () => {
  return (
    <div className="min-h-screen bg-slate-50 pb-28 pt-6">
      <Tabs defaultValue="calendar">
        <div className="px-4">
          {/* Sub-Navigation */}
          <TabsList className="mb-6">
            <TabsTrigger value="calendar">
              Calendar
            </TabsTrigger>
            <TabsTrigger value="buckets">
              Buckets
            </TabsTrigger>
            <TabsTrigger value="accounts">
              Accounts
            </TabsTrigger>
            <TabsTrigger value="transactions">
              Transactions
            </TabsTrigger>
            <TabsTrigger value="history">
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
