import React, { useState, useEffect } from 'react';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import ToDosPage from './ToDosPage';
import MealPlanTab from '../components/meals/MealPlanTab';
import ShoppingListTab from '../components/meals/ShoppingListTab';

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
    } catch (error) {
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
    } catch (error) {
      // Ignore persistence errors
    }
  }, [activeTab]);

  const tabs = [
    { value: 'todos', label: 'To-Dos' },
    { value: 'meals', label: 'Meals' },
    { value: 'shopping', label: 'Shopping' },
  ];

  return (
    <div className="flex flex-col h-full">
      <div className="flex-none px-4 pt-4 pb-2 sticky top-0 z-30 bg-brand-50/95 backdrop-blur-sm">
        <SegmentedControl
          options={tabs}
          value={activeTab}
          onChange={setActiveTab}
          name="Lists Navigation"
        />
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
