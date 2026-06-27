import React, { useState, useEffect } from 'react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import ToDosPage from './ToDosPage';
import MealPlanTab from '@/components/meals/MealPlanTab';
import ShoppingListTab from '@/components/meals/ShoppingListTab';

const VALID_TABS = ['todos', 'meals', 'shopping'] as const;
type TabValue = typeof VALID_TABS[number];

const ListsPage: React.FC = () => {
  // Smart Memory: Initialize from localStorage
  const [activeTab, setActiveTab] = useState<string>(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const stored = window.localStorage.getItem('lists-active-tab');
        if (stored && VALID_TABS.includes(stored as TabValue)) {
          return stored;
        }
      }
    } catch (_error) {
      // Ignore localStorage errors
    }
    return 'todos';
  });

  // Save to localStorage on change
  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem('lists-active-tab', activeTab);
      }
    } catch (_error) {
      // Ignore persistence errors
    }
  }, [activeTab]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-none px-4 pt-4 pb-2 sticky top-0 z-30 bg-brand-50 dark:bg-brand-900 border-b border-brand-200 dark:border-brand-800">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="todos" className="flex-1">To-Dos</TabsTrigger>
            <TabsTrigger value="meals" className="flex-1">Meals</TabsTrigger>
            <TabsTrigger value="shopping" className="flex-1">Shopping</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="flex-1">
        {activeTab === 'todos' ? (
          <ToDosPage />
        ) : (
          <div className="max-w-4xl mx-auto px-4 pb-20 pt-4">
            {{
              meals: <MealPlanTab />,
              shopping: <ShoppingListTab />,
            }[activeTab]}
          </div>
        )}
      </div>
    </div>
  );
};

export default ListsPage;
