import { Habit, Transaction } from '@/types/schema';

/**
 * Keywords mapped to habit categories and titles
 * Used for smart habit suggestions based on transaction merchant/description
 */
const HABIT_KEYWORDS: Record<string, string[]> = {
  // Food & Drink
  food: ['restaurant', 'cafe', 'coffee', 'starbucks', 'dunkin', 'pizza', 'burger', 'mcdonalds', 'wendys', 'subway', 'chipotle', 'taco', 'food', 'diner', 'kitchen', 'grill', 'bbq', 'sushi', 'thai', 'chinese', 'italian'],
  fastfood: ['mcdonalds', 'burger king', 'wendys', 'kfc', 'taco bell', 'arbys', 'popeyes', 'chick-fil-a', 'sonic', 'jack in the box', 'del taco', 'carl\'s jr', 'hardees', 'whataburger'],
  snack: ['snack', '7-eleven', 'convenience', 'gas station', 'circle k', 'wawa', 'sheetz'],
  coffee: ['starbucks', 'coffee', 'cafe', 'dunkin', 'peet\'s', 'dutch bros', 'caribou'],
  alcohol: ['bar', 'pub', 'tavern', 'brewery', 'liquor', 'wine', 'beer', 'spirits', 'total wine', 'bevmo'],
  grocery: ['grocery', 'supermarket', 'safeway', 'kroger', 'albertsons', 'whole foods', 'trader joe', 'aldi', 'costco', 'walmart', 'target', 'publix', 'wegmans', 'h-e-b', 'giant', 'food lion', 'harris teeter'],

  // Exercise & Health
  gym: ['gym', 'fitness', '24 hour', 'planet fitness', 'la fitness', 'equinox', 'crunch', 'anytime fitness', 'gold\'s gym', 'ymca', 'orangetheory', 'crossfit', 'f45'],
  sports: ['sports', 'athletic', 'recreation', 'golf', 'tennis', 'swim', 'yoga', 'pilates', 'cycling', 'run', 'marathon'],
  healthcare: ['doctor', 'dentist', 'medical', 'pharmacy', 'cvs', 'walgreens', 'rite aid', 'clinic', 'hospital', 'urgent care', 'health'],

  // Shopping & Entertainment
  shopping: ['amazon', 'target', 'walmart', 'mall', 'shopping', 'retail', 'store', 'outlet'],
  entertainment: ['movie', 'cinema', 'theater', 'concert', 'amc', 'regal', 'spotify', 'netflix', 'hulu', 'disney+', 'apple tv', 'youtube', 'gaming', 'playstation', 'xbox', 'steam'],
  electronics: ['best buy', 'apple', 'microsoft', 'electronics', 'computer', 'tech'],

  // Transportation
  gas: ['gas', 'fuel', 'shell', 'exxon', 'chevron', 'bp', 'mobil', 'arco', 'valero', 'marathon', 'speedway', 'circle k', '76'],
  uber: ['uber', 'lyft', 'taxi', 'ride share', 'rideshare'],
  parking: ['parking', 'park', 'garage'],

  // Personal Care
  salon: ['salon', 'barber', 'haircut', 'hair', 'beauty', 'spa', 'nail', 'massage'],

  // Hobbies & Learning
  books: ['book', 'barnes', 'amazon books', 'bookstore', 'library'],
  education: ['course', 'class', 'tuition', 'school', 'university', 'college', 'udemy', 'coursera', 'masterclass'],
};

/**
 * Analyzes transaction merchant/description for keywords
 * Returns matching habit categories/keywords
 */
function extractKeywords(merchant: string): string[] {
  const normalizedMerchant = merchant.toLowerCase().trim();
  const matchedKeywords: string[] = [];

  for (const [category, keywords] of Object.entries(HABIT_KEYWORDS)) {
    for (const keyword of keywords) {
      if (normalizedMerchant.includes(keyword)) {
        matchedKeywords.push(category);
        break; // Only add category once
      }
    }
  }

  return matchedKeywords;
}

/**
 * Learns from previous transaction-habit associations
 * Returns habit IDs that were previously associated with similar merchants
 */
function learnFromHistory(
  merchant: string,
  transactions: Transaction[]
): string[] {
  const normalizedMerchant = merchant.toLowerCase().trim();
  const habitCounts = new Map<string, number>();

  // Find transactions with similar merchants
  for (const tx of transactions) {
    if (!tx.relatedHabitIds || tx.relatedHabitIds.length === 0) continue;

    const txMerchant = tx.merchant.toLowerCase().trim();

    // Exact match (highest priority)
    if (txMerchant === normalizedMerchant) {
      for (const habitId of tx.relatedHabitIds) {
        habitCounts.set(habitId, (habitCounts.get(habitId) || 0) + 3);
      }
      continue;
    }

    // Partial match (medium priority)
    const merchantWords = normalizedMerchant.split(/\s+/);
    const txWords = txMerchant.split(/\s+/);
    const hasCommonWord = merchantWords.some(word =>
      word.length > 3 && txWords.some(txWord => txWord.includes(word) || word.includes(txWord))
    );

    if (hasCommonWord) {
      for (const habitId of tx.relatedHabitIds) {
        habitCounts.set(habitId, (habitCounts.get(habitId) || 0) + 1);
      }
    }
  }

  // Sort by frequency and return habit IDs
  return Array.from(habitCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([habitId]) => habitId);
}

/**
 * Checks if a habit matches the extracted keywords
 */
function habitMatchesKeywords(habit: Habit, keywords: string[]): boolean {
  const habitTitle = habit.title.toLowerCase();
  const habitCategory = habit.category.toLowerCase();

  return keywords.some(keyword => {
    const keywordLower = keyword.toLowerCase();
    return habitTitle.includes(keywordLower) ||
           habitCategory.includes(keywordLower) ||
           keywordLower.includes(habitTitle.split(' ')[0]) || // Match first word of habit
           keywordLower.includes(habitCategory);
  });
}

export interface SuggestedHabit {
  habit: Habit;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

/**
 * Returns smart habit suggestions for a transaction
 * Combines keyword matching with historical learning
 *
 * @param merchant - Transaction merchant name
 * @param habits - All available habits
 * @param transactions - Transaction history for learning
 * @param maxSuggestions - Maximum number of high-confidence suggestions to show (default: 5)
 * @returns Array of habits sorted by relevance (suggested first, then others)
 */
export function suggestHabitsForTransaction(
  merchant: string,
  habits: Habit[],
  transactions: Transaction[],
  maxSuggestions: number = 5
): SuggestedHabit[] {
  if (!merchant.trim() || habits.length === 0) {
    return habits.map(habit => ({
      habit,
      confidence: 'low' as const,
      reason: 'No suggestions'
    }));
  }

  // Extract keywords from merchant
  const keywords = extractKeywords(merchant);

  // Learn from historical associations
  const historicalHabitIds = learnFromHistory(merchant, transactions);

  // Score each habit
  const scoredHabits = habits.map(habit => {
    let score = 0;
    let reason = '';
    let confidence: 'high' | 'medium' | 'low' = 'low';

    // Historical match (highest priority)
    const historicalIndex = historicalHabitIds.indexOf(habit.id);
    if (historicalIndex !== -1) {
      // Higher score for habits that appear earlier in historical matches
      score += 100 - (historicalIndex * 10);
      reason = 'Previously used';
      confidence = 'high';
    }

    // Keyword match
    if (keywords.length > 0 && habitMatchesKeywords(habit, keywords)) {
      score += 50;
      if (!reason) {
        reason = 'Keyword match';
        confidence = 'medium';
      }
    }

    // Boost negative habits for spending-related transactions
    if (habit.type === 'negative' && keywords.some(k =>
      ['food', 'fastfood', 'snack', 'coffee', 'shopping', 'entertainment'].includes(k)
    )) {
      score += 20;
    }

    // Boost positive habits for health/exercise
    if (habit.type === 'positive' && keywords.some(k =>
      ['gym', 'sports', 'healthcare', 'grocery'].includes(k)
    )) {
      score += 20;
    }

    return {
      habit,
      score,
      confidence,
      reason: reason || 'Other'
    };
  });

  // Sort by score (descending) and limit high-confidence suggestions
  scoredHabits.sort((a, b) => b.score - a.score);

  // Mark top suggestions as high/medium confidence, rest as low
  let suggestionCount = 0;
  return scoredHabits.map(item => {
    if (item.score > 50 && suggestionCount < maxSuggestions) {
      suggestionCount++;
      return item;
    } else if (item.score > 20 && suggestionCount < maxSuggestions) {
      suggestionCount++;
      return { ...item, confidence: 'medium' as const };
    } else {
      return { ...item, confidence: 'low' as const };
    }
  });
}

/**
 * Returns only high-confidence habit suggestions
 */
export function getTopHabitSuggestions(
  merchant: string,
  habits: Habit[],
  transactions: Transaction[],
  limit: number = 5
): Habit[] {
  const suggestions = suggestHabitsForTransaction(merchant, habits, transactions, limit);
  return suggestions
    .filter(s => s.confidence === 'high' || s.confidence === 'medium')
    .slice(0, limit)
    .map(s => s.habit);
}
