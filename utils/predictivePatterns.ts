import { Transaction } from '@/types/schema';
import { getDay, parseISO, isSameDay, startOfToday, subDays, format } from 'date-fns';

export interface SuggestedAction {
  merchant: string;
  amount: number;
  category: string;
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
}

interface MerchantStats {
  count: number;
  totalAmount: number;
  categoryCounts: Record<string, number>;
  dayOfWeekCounts: Record<number, number>; // 0=Sunday, 6=Saturday
  lastDate: string;
}

/**
 * Analyzes transaction history to predict likely actions for the current day.
 *
 * @param transactions - List of historical transactions
 * @param today - The current date (defaults to system today)
 * @returns Array of suggested actions sorted by confidence
 */
export const generateSmartShortcuts = (
  transactions: Transaction[],
  today: Date = startOfToday()
): SuggestedAction[] => {
  if (!transactions || transactions.length === 0) return [];

  // 1. Filter relevant transactions (Expense, Verified/Pending, Recent?)
  // We use verified for patterns, but maybe pending is okay too? Let's stick to verified + pending to get full picture.
  // We should limit lookback? Maybe last 90 days? For now, use all to find patterns.
  const relevantTx = transactions.filter(t => t.amount > 0);

  // 2. Aggregate Stats by Merchant
  const statsMap = new Map<string, MerchantStats>();

  relevantTx.forEach(tx => {
    const merchantKey = tx.merchant.trim().toLowerCase(); // Normalize
    const originalMerchant = tx.merchant.trim(); // Keep one display version (usually the most recent)

    if (!statsMap.has(merchantKey)) {
      statsMap.set(merchantKey, {
        count: 0,
        totalAmount: 0,
        categoryCounts: {},
        dayOfWeekCounts: {},
        lastDate: tx.date
      });
    }

    const stats = statsMap.get(merchantKey)!;
    stats.count++;
    stats.totalAmount += tx.amount;

    // Category Frequency
    stats.categoryCounts[tx.category] = (stats.categoryCounts[tx.category] || 0) + 1;

    // Day of Week Frequency
    // tx.date is YYYY-MM-DD string
    try {
      const date = parseISO(tx.date);
      const day = getDay(date);
      stats.dayOfWeekCounts[day] = (stats.dayOfWeekCounts[day] || 0) + 1;

      // Track most recent date for display name resolution (simple heuristic)
      if (tx.date > stats.lastDate) {
         stats.lastDate = tx.date;
      }
    } catch (e) {
      // Ignore invalid dates
    }
  });

  const suggestions: SuggestedAction[] = [];
  const currentDayOfWeek = getDay(today);
  const todayStr = format(today, 'yyyy-MM-dd');

  // 3. Analyze Patterns
  statsMap.forEach((stats, merchantKey) => {
    // A. Check if already done today
    const hasTransactionToday = relevantTx.some(tx =>
      tx.merchant.trim().toLowerCase() === merchantKey &&
      isSameDay(parseISO(tx.date), today)
    );

    if (hasTransactionToday) return;

    // B. Determine Most Frequent Category
    let topCategory = 'Uncategorized';
    let maxCatCount = 0;
    Object.entries(stats.categoryCounts).forEach(([cat, count]) => {
      if (count > maxCatCount) {
        maxCatCount = count;
        topCategory = cat;
      }
    });

    // C. Determine Display Name (Find a transaction with this key to get original casing)
    // Simple approach: find first match in list.
    // Optimization: We could have stored 'displayName' in stats.
    const sampleTx = relevantTx.find(t => t.merchant.trim().toLowerCase() === merchantKey);
    const displayName = sampleTx ? sampleTx.merchant.trim() : merchantKey;

    // D. Calculate Average Amount
    const avgAmount = parseFloat((stats.totalAmount / stats.count).toFixed(2));

    // E. Evaluate Patterns

    // Rule 1: Day Specific (High Confidence)
    // E.g. 3+ times total, and >30% of them are on this day of week
    const countOnThisDay = stats.dayOfWeekCounts[currentDayOfWeek] || 0;
    const dayFrequency = countOnThisDay / stats.count;

    if (stats.count >= 3 && dayFrequency >= 0.3 && countOnThisDay >= 2) {
      suggestions.push({
        merchant: displayName,
        amount: avgAmount,
        category: topCategory,
        confidence: 'high',
        reasoning: `Usually on ${format(today, 'EEEE')}s`
      });
      return;
    }

    // Rule 2: High Overall Frequency (Medium Confidence)
    // E.g. > 5 times total, implies a regular habit like coffee
    if (stats.count >= 5) {
      suggestions.push({
        merchant: displayName,
        amount: avgAmount,
        category: topCategory,
        confidence: 'medium',
        reasoning: 'Frequent expense'
      });
      return;
    }
  });

  // 4. Sort and Limit
  // High confidence first, then frequency
  return suggestions.sort((a, b) => {
    if (a.confidence === 'high' && b.confidence !== 'high') return -1;
    if (a.confidence !== 'high' && b.confidence === 'high') return 1;
    return 0; // Stable sort
  }).slice(0, 3); // Top 3
};
