import React, { useState } from 'react';
import { Star } from 'lucide-react';
import clsx from 'clsx';

interface RecipeRateToastProps {
  mealName: string;
  onRate: (rating: number) => void;
}

// Toast body for the post-cook quick-rate prompt: meal name + a 1-5 star
// picker. react-hot-toast has no built-in interactive slot, so this renders
// inside toast((t) => ...) same as ShoppingListTab's DeleteUndoToast. Toasts
// always sit on the dark brand-800 surface (Toaster config in App.tsx), so
// light-tint text/star-outline colors are correct in both themes.
export const RecipeRateToast: React.FC<RecipeRateToastProps> = ({ mealName, onRate }) => {
  const [hovered, setHovered] = useState<number | null>(null);

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="min-w-0 truncate text-sm" title={mealName}>
        How was &ldquo;{mealName}&rdquo;?
      </span>
      <div className="flex items-center gap-0.5" role="group" aria-label="Rate this recipe">
        {[1, 2, 3, 4, 5].map((value) => {
          const filled = hovered !== null ? value <= hovered : false;
          return (
            <button
              key={value}
              type="button"
              onClick={() => onRate(value)}
              onMouseEnter={() => setHovered(value)}
              onMouseLeave={() => setHovered(null)}
              aria-label={`${value} star${value === 1 ? '' : 's'}`}
              className="flex min-h-[36px] min-w-[36px] items-center justify-center text-brand-450 hover:text-warm-300 focus:outline-hidden focus-visible:text-warm-300"
            >
              <Star
                size={20}
                fill={filled ? 'currentColor' : 'none'}
                className={clsx(filled && 'text-warm-300')}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
};
