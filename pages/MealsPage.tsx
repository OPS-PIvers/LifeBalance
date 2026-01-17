import React, { useState } from 'react';
import PantryTab from '@/components/meals/PantryTab';
import MealPlanTab from '@/components/meals/MealPlanTab';
import ShoppingListTab from '@/components/meals/ShoppingListTab';
import { ChefHat, Calendar, ShoppingCart } from 'lucide-react';

const MealsPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'pantry' | 'meal-plan' | 'shopping-list'>('pantry');

  // Mobile-first tab navigation
  const tabs = [
    { id: 'pantry', label: 'Pantry', icon: ChefHat },
    { id: 'meal-plan', label: 'Meal Plan', icon: Calendar },
    { id: 'shopping-list', label: 'Shopping List', icon: ShoppingCart },
  ];

  return (
    <div className="max-w-4xl mx-auto px-4 pb-20 pt-4">
      {/* Tab Navigation */}
      <div className="flex justify-between bg-white rounded-xl shadow-sm p-1 mb-6" role="tablist">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              aria-controls={`panel-${tab.id}`}
              id={`tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id as 'pantry' | 'meal-plan' | 'shopping-list')}
              className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-medium transition-all
                ${isActive
                  ? 'bg-brand-100 text-brand-700 shadow-sm'
                  : 'text-gray-500 hover:bg-gray-50'
                }`}
            >
              <Icon className={`w-4 h-4 ${isActive ? 'text-brand-600' : 'text-gray-400'}`} />
              <span className="hidden sm:inline">{tab.label}</span>
              <span className="sm:hidden text-xs">{tab.label === 'Shopping List' ? 'Shop' : tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div className="min-h-[60vh]">
        {activeTab === 'pantry' && (
          <div role="tabpanel" id="panel-pantry" aria-labelledby="tab-pantry">
            <PantryTab />
          </div>
        )}
        {activeTab === 'meal-plan' && (
          <div role="tabpanel" id="panel-meal-plan" aria-labelledby="tab-meal-plan">
            <MealPlanTab />
          </div>
        )}
        {activeTab === 'shopping-list' && (
          <div role="tabpanel" id="panel-shopping-list" aria-labelledby="tab-shopping-list">
            <ShoppingListTab />
          </div>
        )}
      </div>
    </div>
  );
};

export default MealsPage;
