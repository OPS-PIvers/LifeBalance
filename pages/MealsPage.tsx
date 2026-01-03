import React, { useState } from 'react';
import { useHousehold } from '@/contexts/FirebaseHouseholdContext';
import PantryTab from '@/components/meals/PantryTab';
import MealPlanTab from '@/components/meals/MealPlanTab';
import ShoppingListTab from '@/components/meals/ShoppingListTab';
import { ChefHat, ShoppingCart, Calendar } from 'lucide-react';

const MealsPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'pantry' | 'meal-plan' | 'shopping-list'>('pantry');

  // Mobile-first tab navigation
  const tabs = [
    { id: 'pantry', label: 'Pantry', icon: ChefHat },
    { id: 'meal-plan', label: 'Meal Plan', icon: Calendar },
    { id: 'shopping-list', label: 'Shopping', icon: ShoppingCart },
  ];

  return (
    <div className="max-w-4xl mx-auto px-4 pb-20 pt-4">
      {/* Tab Navigation */}
      <div className="flex justify-between bg-white rounded-xl shadow-sm p-1 mb-6">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-medium transition-all
                ${isActive
                  ? 'bg-brand-100 text-brand-700 shadow-sm'
                  : 'text-gray-500 hover:bg-gray-50'
                }`}
            >
              <Icon className={`w-4 h-4 ${isActive ? 'text-brand-600' : 'text-gray-400'}`} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div className="min-h-[60vh]">
        {activeTab === 'pantry' && <PantryTab />}
        {activeTab === 'meal-plan' && <MealPlanTab />}
        {activeTab === 'shopping-list' && <ShoppingListTab />}
      </div>
    </div>
  );
};

export default MealsPage;
