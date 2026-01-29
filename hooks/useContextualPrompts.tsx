import React, { useMemo } from 'react';
import { Utensils, Moon, ShoppingBag, Coffee } from 'lucide-react';

export interface ContextualPrompt {
  id: string;
  label: string;
  icon: React.ReactNode;
  magicText: string;
}

export const useContextualPrompts = () => {
  const prompts = useMemo(() => {
    const now = new Date();
    const currentHour = now.getHours();
    const result: ContextualPrompt[] = [];

    // Morning (5am - 11am)
    if (currentHour >= 5 && currentHour < 11) {
      result.push({
        id: 'coffee',
        label: 'Coffee',
        icon: <Coffee size={14} />,
        magicText: 'Coffee $5'
      });
      result.push({
        id: 'bfast',
        label: 'Breakfast',
        icon: <Utensils size={14} />,
        magicText: 'Breakfast'
      });
    }
    // Lunch (11am - 2pm)
    else if (currentHour >= 11 && currentHour < 14) {
      result.push({
        id: 'lunch',
        label: 'Log Lunch',
        icon: <Utensils size={14} />,
        magicText: 'Lunch'
      });
    }
    // Afternoon (2pm - 5pm)
    else if (currentHour >= 14 && currentHour < 17) {
      result.push({
        id: 'snack',
        label: 'Snack',
        icon: <Utensils size={14} />,
        magicText: 'Snack'
      });
    }
    // Evening (5pm - 9pm)
    else if (currentHour >= 17 && currentHour < 21) {
      result.push({
        id: 'dinner',
        label: 'Dinner',
        icon: <Utensils size={14} />,
        magicText: 'Dinner'
      });
    }
    // Night (9pm - 5am)
    else {
      result.push({
        id: 'late_snack',
        label: 'Late Snack',
        icon: <Moon size={14} />,
        magicText: 'Late night snack'
      });
    }

    // Always useful
    result.push({
      id: 'groceries',
      label: 'Groceries',
      icon: <ShoppingBag size={14} />,
      magicText: 'Groceries at Safeway'
    });

    return result;
  }, []);

  return { prompts };
};
