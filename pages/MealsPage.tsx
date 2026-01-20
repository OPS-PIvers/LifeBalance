import React from 'react';
import PantryTab from '@/components/meals/PantryTab';
import MealPlanTab from '@/components/meals/MealPlanTab';
import ShoppingListTab from '@/components/meals/ShoppingListTab';
import { ChefHat, Calendar, ShoppingCart } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs';

const MealsPage: React.FC = () => {
  // Mobile-first tab navigation
  const tabs = [
    { id: 'pantry', label: 'Pantry', icon: ChefHat },
    { id: 'meal-plan', label: 'Meal Plan', icon: Calendar },
    { id: 'shopping-list', label: 'Shopping List', shortLabel: 'Shop', icon: ShoppingCart },
  ];

  return (
    <div className="max-w-4xl mx-auto px-4 pb-20 pt-4">
      <Tabs defaultValue="pantry">
        {/* Tab Navigation */}
        <TabsList className="mb-6">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <TabsTrigger key={tab.id} value={tab.id}>
                <Icon className="w-4 h-4" />
                <span className="hidden sm:inline">{tab.label}</span>
                <span className="sm:hidden text-xs">{tab.shortLabel || tab.label}</span>
              </TabsTrigger>
            );
          })}
        </TabsList>

        {/* Tab Content */}
        <div className="min-h-[60vh]">
          <TabsContent value="pantry">
            <PantryTab />
          </TabsContent>
          <TabsContent value="meal-plan">
            <MealPlanTab />
          </TabsContent>
          <TabsContent value="shopping-list">
            <ShoppingListTab />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
};

export default MealsPage;
