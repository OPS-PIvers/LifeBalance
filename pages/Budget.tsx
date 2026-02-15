
import React from 'react';
import { LayoutGrid } from 'lucide-react';
import BudgetCalendar from '../components/budget/BudgetCalendar';
import BudgetBuckets from '../components/budget/BudgetBuckets';
import BudgetAccounts from '../components/budget/BudgetAccounts';
import TransactionMasterList from '../components/budget/TransactionMasterList';
import BudgetHistory from '../components/budget/BudgetHistory';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs';
import Select from '@/components/ui/Select';

type BudgetView = 'calendar' | 'buckets' | 'accounts' | 'transactions' | 'history';

const BUDGET_VIEWS: { id: BudgetView; label: string }[] = [
  { id: 'calendar', label: 'Calendar' },
  { id: 'buckets', label: 'Buckets' },
  { id: 'accounts', label: 'Accounts' },
  { id: 'transactions', label: 'Transactions' },
  { id: 'history', label: 'History' },
];

const Budget: React.FC = () => {
  const [activeTab, setActiveTab] = React.useState<BudgetView>("calendar");

  return (
    <div className="min-h-screen bg-slate-50 pb-28 pt-6">
      <Tabs value={activeTab} onValueChange={(val) => setActiveTab(val as BudgetView)}>
        <div className="px-4">

          {/* Mobile Navigation */}
          <div className="md:hidden mb-6">
            <Select
              value={activeTab}
              onChange={(e) => setActiveTab(e.target.value as BudgetView)}
              icon={<LayoutGrid size={18} className="text-brand-500" />}
              className="font-bold text-lg py-3 shadow-sm border-brand-100"
              aria-label="Select view"
            >
              {BUDGET_VIEWS.map((view) => (
                <option key={view.id} value={view.id}>
                  {view.label}
                </option>
              ))}
            </Select>
          </div>

          {/* Desktop Navigation */}
          <TabsList className="hidden md:flex mb-6 overflow-x-auto no-scrollbar">
            {BUDGET_VIEWS.map((view) => (
              <TabsTrigger key={view.id} value={view.id} className="min-w-[80px]">
                {view.label}
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
