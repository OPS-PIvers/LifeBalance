import { describe, it, expect } from 'vitest';
import { scaleQuantity } from '@/utils/scaleQuantity';

describe('scaleQuantity', () => {
  it('scales a simple integer quantity', () => {
    expect(scaleQuantity('2 cups', 2)).toBe('4 cups');
  });

  it('scales a decimal quantity', () => {
    expect(scaleQuantity('1.5 lb', 2)).toBe('3 lb');
  });

  it('scales a simple fraction quantity', () => {
    expect(scaleQuantity('1/2 cup', 2)).toBe('1 cup');
  });

  it('rounds to at most 2 decimal places and trims trailing zeros', () => {
    expect(scaleQuantity('1 cup', 1 / 3)).toBe('0.33 cup');
  });

  it('handles a bare number with no unit', () => {
    expect(scaleQuantity('2', 3)).toBe('6');
  });

  it('scales down (factor < 1)', () => {
    expect(scaleQuantity('4 eggs', 0.5)).toBe('2 eggs');
  });

  it('returns unparseable quantities unchanged', () => {
    expect(scaleQuantity('a pinch', 2)).toBe('a pinch');
    expect(scaleQuantity('to taste', 2)).toBe('to taste');
  });

  it('returns undefined/empty input unchanged', () => {
    expect(scaleQuantity(undefined, 2)).toBeUndefined();
    expect(scaleQuantity('', 2)).toBe('');
  });

  it('never throws and returns original for factor of 1', () => {
    expect(scaleQuantity('2 cups', 1)).toBe('2 cups');
  });

  it('returns original for a non-finite or non-positive factor', () => {
    expect(scaleQuantity('2 cups', 0)).toBe('2 cups');
    expect(scaleQuantity('2 cups', -1)).toBe('2 cups');
    expect(scaleQuantity('2 cups', NaN)).toBe('2 cups');
  });

  it('preserves extra notes after the unit', () => {
    expect(scaleQuantity('2 cups, diced', 2)).toBe('4 cups, diced');
  });
});
