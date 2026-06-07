import { ShoppingItem } from '@/types/schema';

export const formatShoppingListForShare = (items: ShoppingItem[]): string => {
  if (items.length === 0) return '';

  const groupedItems = items.reduce((acc, item) => {
    const category = item.category || 'Uncategorized';
    if (!acc[category]) acc[category] = [];
    acc[category].push(item);
    return acc;
  }, {} as Record<string, ShoppingItem[]>);

  const sortedCategories = Object.keys(groupedItems).sort();

  const lines: string[] = ['🛒 Shopping List', ''];

  sortedCategories.forEach(category => {
    lines.push(`${category}:`);
    // category comes from Object.keys(groupedItems), so groupedItems[category] is always defined.
    groupedItems[category]!.forEach(item => {
      let line = `- `;
      if (item.store) {
        line += `[${item.store}] `;
      }
      line += item.name;
      if (item.quantity) {
        line += ` (${item.quantity})`;
      }
      lines.push(line);
    });
    lines.push(''); // Empty line between categories
  });

  return lines.join('\n').trim();
};
