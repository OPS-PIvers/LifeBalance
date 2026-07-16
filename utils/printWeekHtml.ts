import { GroupedShoppingStore } from '@/utils/shoppingListFormatter';
import { FormattedMealDay } from '@/utils/mealPlanFormatter';

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/**
 * Builds a standalone, chrome-free HTML document for the fridge-friendly
 * "Print week" view: the week's planned meals followed by the shopping list,
 * in a clean typographic layout meant to be printed via `window.print()`.
 * Self-contained (inline `<style>`, no external stylesheet) so it renders
 * correctly in the popup window it's opened into.
 */
export const buildPrintWeekHtml = (
  weekRangeLabel: string,
  mealDays: FormattedMealDay[],
  shoppingStores: GroupedShoppingStore[]
): string => {
  const populatedDays = mealDays.filter(day => day.items.length > 0);

  const mealsHtml = populatedDays.length
    ? populatedDays
        .map(
          day => `
        <section class="day">
          <h3>${escapeHtml(day.label)}</h3>
          <ul class="meals">
            ${day.items
              .map(
                item =>
                  `<li><span class="meal-type">${escapeHtml(item.typeLabel)}</span><span class="meal-name">${escapeHtml(item.mealName)}</span></li>`
              )
              .join('')}
          </ul>
        </section>`
        )
        .join('')
    : '<p class="empty">No meals planned this week.</p>';

  const shoppingHtml = shoppingStores.length
    ? shoppingStores
        .map(
          store => `
        <section class="store">
          <h3>${escapeHtml(store.storeLabel)}</h3>
          ${store.categories
            .map(
              category => `
            <div class="category">
              <h4>${escapeHtml(category.display)}</h4>
              <ul class="items">
                ${category.items
                  .map(
                    item =>
                      `<li><span class="box"></span>${escapeHtml(item.name)}${item.quantity ? ` <span class="qty">(${escapeHtml(item.quantity)})</span>` : ''}</li>`
                  )
                  .join('')}
              </ul>
            </div>`
            )
            .join('')}
        </section>`
        )
        .join('')
    : '<p class="empty">Shopping list is empty.</p>';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Meal Plan &amp; Shopping List — ${escapeHtml(weekRangeLabel)}</title>
<style>
  @font-face {
    font-family: 'Besley';
    font-weight: 400 600;
    font-display: swap;
    src: url('/fonts/besley-latin.woff2') format('woff2');
  }
  @font-face {
    font-family: 'Schibsted Grotesk';
    font-weight: 400 700;
    font-display: swap;
    src: url('/fonts/schibsted-grotesk-latin.woff2') format('woff2');
  }
  * { box-sizing: border-box; }
  body {
    font-family: 'Schibsted Grotesk', system-ui, sans-serif;
    color: #1c1a17;
    background: #fff;
    margin: 0;
    padding: 32px 40px 48px;
    max-width: 820px;
  }
  h1 {
    font-family: 'Besley', Georgia, serif;
    font-size: 28px;
    font-weight: 600;
    margin: 0 0 4px;
  }
  .subtitle {
    font-size: 13px;
    color: #6b6459;
    margin: 0 0 24px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  h2.section {
    font-family: 'Besley', Georgia, serif;
    font-size: 18px;
    font-weight: 600;
    border-bottom: 2px solid #1c1a17;
    padding-bottom: 6px;
    margin: 28px 0 14px;
  }
  .day { break-inside: avoid; margin-bottom: 14px; }
  .day h3 {
    font-size: 14px;
    font-weight: 700;
    margin: 0 0 4px;
  }
  ul.meals { list-style: none; margin: 0; padding: 0; }
  ul.meals li {
    display: flex;
    gap: 8px;
    font-size: 13px;
    padding: 2px 0;
  }
  .meal-type {
    width: 84px;
    flex-shrink: 0;
    color: #6b6459;
    text-transform: uppercase;
    font-size: 11px;
    letter-spacing: 0.04em;
    padding-top: 1px;
  }
  .shopping-grid {
    columns: 2;
    column-gap: 32px;
  }
  .store { break-inside: avoid; margin-bottom: 16px; }
  .store h3 {
    font-size: 13px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin: 0 0 6px;
  }
  .category { margin-bottom: 8px; }
  .category h4 {
    font-size: 12px;
    font-weight: 700;
    color: #6b6459;
    margin: 0 0 2px;
  }
  ul.items { list-style: none; margin: 0; padding: 0; }
  ul.items li {
    display: flex;
    align-items: baseline;
    gap: 6px;
    font-size: 13px;
    padding: 2px 0;
  }
  .box {
    display: inline-block;
    width: 10px;
    height: 10px;
    border: 1.5px solid #1c1a17;
    border-radius: 2px;
    flex-shrink: 0;
  }
  .qty { color: #6b6459; }
  .empty { font-size: 13px; color: #6b6459; font-style: italic; }
  @media print {
    body { padding: 0; max-width: none; }
    @page { margin: 16mm; }
  }
</style>
</head>
<body>
  <h1>Meal Plan &amp; Shopping List</h1>
  <p class="subtitle">${escapeHtml(weekRangeLabel)}</p>

  <h2 class="section">This Week's Meals</h2>
  ${mealsHtml}

  <h2 class="section">Shopping List</h2>
  <div class="shopping-grid">
    ${shoppingHtml}
  </div>
</body>
</html>`;
};
