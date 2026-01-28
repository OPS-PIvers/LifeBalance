import React, { useState, useEffect } from 'react';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import ToDosPage from './ToDosPage';
import MealPlanTab from '../components/meals/MealPlanTab';
import ShoppingListTab from '../components/meals/ShoppingListTab';

const ListsPage: React.FC = () => {
  // Smart Memory: Initialize from localStorage
  const [activeTab, setActiveTab] = useState(() => {
    return localStorage.getItem('lists-active-tab') || 'todos';
  });

  // Save to localStorage on change
  useEffect(() => {
    localStorage.setItem('lists-active-tab', activeTab);
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
