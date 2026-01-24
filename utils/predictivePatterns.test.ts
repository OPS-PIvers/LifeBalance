import { describe, it, expect } from 'vitest';
import { generateSmartShortcuts } from './predictivePatterns';
import { Transaction } from '@/types/schema';
import { addDays, format, subDays, startOfToday } from 'date-fns';

// Helper to create mock transactions
const createTx = (
  merchant: string,
  amount: number,
  date: string
): Transaction => ({
  id: 'mock-id',
  merchant,
  amount,
  category: 'Test',
  date,
  status: 'verified',
  isRecurring: false,
  source: 'manual',
  autoCategorized: false
});

describe('generateSmartShortcuts', () => {
  const today = startOfToday(); // Assume today is the reference date
  // We need to pick a fixed "today" for deterministic testing.
  // Let's assume today is Sunday (day 0) for the test logic,
  // but since the function takes `today` as arg, we can control it.

  // Let's pick a specific Sunday: 2024-03-10
  const mockToday = new Date('2024-03-10T12:00:00'); // Sunday

  it('should return high confidence suggestion for consistent Sunday purchases', () => {
    // 3 past Sundays
    const history = [
      createTx('Sunday Cafe', 10, format(subDays(mockToday, 7), 'yyyy-MM-dd')),
      createTx('Sunday Cafe', 12, format(subDays(mockToday, 14), 'yyyy-MM-dd')),
      createTx('Sunday Cafe', 11, format(subDays(mockToday, 21), 'yyyy-MM-dd')),
      // Noise
      createTx('Random Shop', 50, format(subDays(mockToday, 2), 'yyyy-MM-dd')),
    ];

    const suggestions = generateSmartShortcuts(history, mockToday);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].merchant).toBe('Sunday Cafe');
    expect(suggestions[0].amount).toBe(11); // Average of 10, 12, 11
    expect(suggestions[0].confidence).toBe('high');
    expect(suggestions[0].reasoning).toContain('Sunday');
  });

  it('should return medium confidence for frequent purchases', () => {
    // 5 purchases on random days
    const history = [
      createTx('Daily Coffee', 5, format(subDays(mockToday, 1), 'yyyy-MM-dd')),
      createTx('Daily Coffee', 5, format(subDays(mockToday, 2), 'yyyy-MM-dd')),
      createTx('Daily Coffee', 5, format(subDays(mockToday, 3), 'yyyy-MM-dd')),
      createTx('Daily Coffee', 5, format(subDays(mockToday, 4), 'yyyy-MM-dd')),
      createTx('Daily Coffee', 5, format(subDays(mockToday, 5), 'yyyy-MM-dd')),
    ];

    const suggestions = generateSmartShortcuts(history, mockToday);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].merchant).toBe('Daily Coffee');
    expect(suggestions[0].confidence).toBe('medium');
  });

  it('should not suggest if transaction already exists today', () => {
    const history = [
      createTx('Sunday Cafe', 10, format(subDays(mockToday, 7), 'yyyy-MM-dd')),
      createTx('Sunday Cafe', 10, format(subDays(mockToday, 14), 'yyyy-MM-dd')),
      createTx('Sunday Cafe', 10, format(subDays(mockToday, 21), 'yyyy-MM-dd')),
      // Done today already
      createTx('Sunday Cafe', 10, format(mockToday, 'yyyy-MM-dd')),
    ];

    const suggestions = generateSmartShortcuts(history, mockToday);
    expect(suggestions).toHaveLength(0);
  });

  it('should limit to top 3 suggestions', () => {
    const history = [];
    // Create 4 distinct frequent merchants
    for(let i=1; i<=5; i++) {
        for(let j=0; j<5; j++) {
            history.push(createTx(`Shop ${i}`, 10, format(subDays(mockToday, j+1), 'yyyy-MM-dd')));
        }
    }

    const suggestions = generateSmartShortcuts(history, mockToday);
    expect(suggestions).toHaveLength(3);
  });

  it('should prioritize high confidence over medium', () => {
    const history = [
      // High confidence (Sunday habit)
      createTx('Sunday Cafe', 10, format(subDays(mockToday, 7), 'yyyy-MM-dd')),
      createTx('Sunday Cafe', 10, format(subDays(mockToday, 14), 'yyyy-MM-dd')),
      createTx('Sunday Cafe', 10, format(subDays(mockToday, 21), 'yyyy-MM-dd')),

      // Medium confidence (Frequent)
      createTx('Daily Coffee', 5, format(subDays(mockToday, 1), 'yyyy-MM-dd')),
      createTx('Daily Coffee', 5, format(subDays(mockToday, 2), 'yyyy-MM-dd')),
      createTx('Daily Coffee', 5, format(subDays(mockToday, 3), 'yyyy-MM-dd')),
      createTx('Daily Coffee', 5, format(subDays(mockToday, 4), 'yyyy-MM-dd')),
      createTx('Daily Coffee', 5, format(subDays(mockToday, 5), 'yyyy-MM-dd')),
    ];

    const suggestions = generateSmartShortcuts(history, mockToday);

    expect(suggestions[0].merchant).toBe('Sunday Cafe');
    expect(suggestions[0].confidence).toBe('high');

    expect(suggestions[1].merchant).toBe('Daily Coffee');
    expect(suggestions[1].confidence).toBe('medium');
  });
});
