import React from 'react';
import { Sparkles } from 'lucide-react';

interface ContextualSuggestionsProps {
  onSelect: (text: string) => void;
}

export const ContextualSuggestions: React.FC<ContextualSuggestionsProps> = ({ onSelect }) => {
  const hour = new Date().getHours();

  const getSuggestions = () => {
    if (hour >= 5 && hour < 11) return [
      { icon: '☕️', text: 'Coffee', prompt: 'Coffee $5' },
      { icon: '📝', text: 'Daily Tasks', prompt: 'Add daily tasks' },
      { icon: '🍳', text: 'Breakfast', prompt: 'Breakfast $15' }
    ];
    if (hour >= 11 && hour < 14) return [
      { icon: '🥗', text: 'Log Lunch', prompt: 'Lunch $20' },
      { icon: '🛒', text: 'Groceries', prompt: 'Groceries $100' },
      { icon: '⚡️', text: 'Quick Energy', prompt: 'Snack $5' }
    ];
    if (hour >= 14 && hour < 18) return [
      { icon: '🛒', text: 'Shopping', prompt: 'Shopping $50' },
      { icon: '☕️', text: 'Coffee Break', prompt: 'Coffee $5' },
      { icon: '🚌', text: 'Commute', prompt: 'Gas $50' }
    ];
    if (hour >= 18 && hour < 22) return [
      { icon: '🍽️', text: 'Log Dinner', prompt: 'Dinner $40' },
      { icon: '💪', text: 'Workout', prompt: 'Gym session' },
      { icon: '🌙', text: 'Wind Down', prompt: 'Read book' }
    ];
    return [ // Night
      { icon: '😴', text: 'Sleep', prompt: 'Sleep' },
      { icon: '🥤', text: 'Late Snack', prompt: 'Snack $10' }
    ];
  };

  const suggestions = getSuggestions();

  return (
    <div className="flex flex-wrap gap-2 mb-6 animate-in fade-in slide-in-from-top-2">
      <div className="w-full flex items-center gap-2 mb-1 text-xs font-bold text-violet-500 uppercase tracking-wider">
        <Sparkles size={12} />
        <span>Suggested Actions</span>
      </div>
      {suggestions.map((s, i) => (
        <button
          key={i}
          onClick={() => onSelect(s.prompt)}
          className="flex items-center gap-2 px-3 py-1.5 bg-violet-50 hover:bg-violet-100 text-violet-700 rounded-full text-xs font-medium border border-violet-100 transition-colors active:scale-95"
        >
          <span>{s.icon}</span>
          <span>{s.text}</span>
        </button>
      ))}
    </div>
  );
};
