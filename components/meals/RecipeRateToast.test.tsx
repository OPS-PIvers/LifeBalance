import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RecipeRateToast } from './RecipeRateToast';

describe('RecipeRateToast', () => {
  it('renders the meal name and five star buttons', () => {
    render(<RecipeRateToast mealName="Tacos" onRate={vi.fn()} />);
    expect(screen.getByText('How was “Tacos”?')).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(5);
  });

  it('calls onRate with the tapped star value', () => {
    const onRate = vi.fn();
    render(<RecipeRateToast mealName="Tacos" onRate={onRate} />);
    fireEvent.click(screen.getByLabelText('4 stars'));
    expect(onRate).toHaveBeenCalledWith(4);
  });

  it('uses singular label for one star', () => {
    render(<RecipeRateToast mealName="Tacos" onRate={vi.fn()} />);
    expect(screen.getByLabelText('1 star')).toBeInTheDocument();
  });
});
