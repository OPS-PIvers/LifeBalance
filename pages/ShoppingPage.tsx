import React from 'react';
import ShoppingListTab from '@/components/meals/ShoppingListTab';

const ShoppingPage: React.FC = () => {
  return (
    <div className="max-w-4xl mx-auto px-4 pb-20 pt-4">
      <h1 className="text-2xl font-semibold mb-4">Shopping List</h1>
      <ShoppingListTab />
    </div>
  );
};

export default ShoppingPage;
