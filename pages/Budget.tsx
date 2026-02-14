
import React from 'react';
import { LayoutGrid } from 'lucide-react';
import BudgetCalendar from '../components/budget/BudgetCalendar';
import BudgetBuckets from '../components/budget/BudgetBuckets';
import BudgetAccounts from '../components/budget/BudgetAccounts';
import TransactionMasterList from '../components/budget/TransactionMasterList';
import BudgetHistory from '../components/budget/BudgetHistory';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs';
import Select from '@/components/ui/Select';

const Budget: React.FC = () => {
  const [activeTab, setActiveTab] = React.useState("calendar");

  return (
    <div className="min-h-screen bg-slate-50 pb-28 pt-6">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="px-4">

          {/* Mobile Navigation */}
          <div className="md:hidden mb-6">
            <Select
              value={activeTab}
              onChange={(e) => setActiveTab(e.target.value)}
              icon={<LayoutGrid size={18} className="text-brand-500" />}
              className="font-bold text-lg py-3 shadow-sm border-brand-100"
              aria-label="Select view"
            >
              <option value="calendar">Calendar</option>
              <option value="buckets">Buckets</option>
              <option value="accounts">Accounts</option>
              <option value="transactions">Transactions</option>
              <option value="history">History</option>
            </Select>
          </div>

          {/* Desktop Navigation */}
          <TabsList className="hidden md:flex mb-6 overflow-x-auto no-scrollbar">
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
