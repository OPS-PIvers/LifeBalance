import { MealIngredient } from '@/types/schema';
import { PrintDay, PrintMeal, PrintShoppingStore, PrintWeek } from '@/utils/printWeekModel';

// Accepts `string | number` because `ShoppingItem.quantity` is typed `string`
// but some documents hold a raw Firestore number for this field (rows written
// by the quickAdd Cloud Function before the quantity-handling fix landed;
// shoppingItemConverter does a blind cast with no coercion, and no migration
// was run) — String() coercion here reads that legacy shape correctly rather
// than throwing (`value.replace is not a function`) when a caller passes a
// numeric `item.quantity` straight through, matching the pattern established
// by parseQuantity/mergeQuantity in utils/grocerySmartDefaults.ts.
const escapeHtml = (value: string | number): string =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const qtyHtml = (quantity: string | number | undefined): string =>
  quantity || quantity === 0 ? ` <span class="qty">${escapeHtml(quantity)}</span>` : '';

const ingredientList = (ingredients: MealIngredient[], kind: 'need' | 'have'): string =>
  ingredients.length
    ? `<ul class="ings ${kind}">${ingredients
        .map(
          ing =>
            `<li><span class="box${kind === 'have' ? ' checked' : ''}"></span><span>${escapeHtml(ing.name)}${
              kind === 'need' ? qtyHtml(ing.quantity) : ''
            }</span></li>`
        )
        .join('')}</ul>`
    : '';

// Still-to-buy ingredients come first as open checkboxes; on-hand ones follow
// as a second, pre-checked group in grey.
const mealHtml = (meal: PrintMeal, showType: boolean): string => `
          <article class="meal">
            <h3>${escapeHtml(meal.mealName)}${showType ? ` <span class="meal-type">${escapeHtml(meal.typeLabel)}</span>` : ''}</h3>
            ${ingredientList(meal.toBuy, 'need')}${ingredientList(meal.onHand, 'have')}
          </article>`;

const dayHtml = (day: PrintDay, showType: boolean): string => `
        <section class="day${day.meals.length ? '' : ' empty-day'}">
          <div class="date"><span class="weekday">${escapeHtml(day.weekday)}</span><span class="num">${escapeHtml(day.dayOfMonth)}</span></div>
          <div class="meals">${day.meals.map(meal => mealHtml(meal, showType)).join('')}</div>
        </section>`;

const shoppingHtml = (stores: PrintShoppingStore[]): string =>
  stores.length
    ? stores
        .map(
          store => `
        <section class="store">
          <h3>${escapeHtml(store.storeLabel)}</h3>
          <ul>${store.items
            .map(item => `<li><span class="box"></span><span>${escapeHtml(item.name)}${qtyHtml(item.quantity)}</span></li>`)
            .join('')}</ul>
        </section>`
        )
        .join('')
    : '<p class="empty">Nothing on the list.</p>';

/**
 * Builds a standalone, chrome-free HTML document for the fridge-friendly
 * "Print week" view: one US Letter page with the seven days down the left
 * (each meal's ingredients as a three-column checklist: still-to-buy open,
 * on-hand pre-checked beneath) and the shopping list down the right.
 * Self-contained (inline `<style>`, no external stylesheet) so it renders
 * correctly in the popup window it's opened into. Sizes are in rem so
 * `fitPrintSheet` can shrink a busy week onto the one page.
 */
export const buildPrintWeekHtml = (weekRangeLabel: string, week: PrintWeek): string => {
  // Meal-type labels only earn their ink when the week mixes types; a week of
  // dinners would otherwise repeat "Dinner" on every row.
  const showType = week.days.some(day => day.meals.some(meal => meal.typeLabel !== 'Dinner'));

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Meal Plan — ${escapeHtml(weekRangeLabel)}</title>
<style>
  @font-face {
    font-family: 'Besley';
    font-weight: 400 700;
    font-display: block;
    src: url('/fonts/besley-latin.woff2') format('woff2');
  }
  @font-face {
    font-family: 'Schibsted Grotesk';
    font-weight: 400 700;
    font-display: block;
    src: url('/fonts/schibsted-grotesk-latin.woff2') format('woff2');
  }
  @page { size: letter portrait; margin: 0.5in; }
  :root {
    --ink: #161512;
    --muted: #6b655b;
    --faint: #b3ada2;
    --rule: #dcd7ce;
    font-size: 13px;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body {
    font-family: 'Schibsted Grotesk', system-ui, sans-serif;
    color: var(--ink);
    background: #e8e5de;
  }
  .paper {
    width: 8.5in;
    height: 11in;
    margin: 24px auto;
    padding: 0.5in;
    background: #fff;
    box-shadow: 0 1px 3px rgba(0,0,0,.12), 0 8px 24px rgba(0,0,0,.08);
  }
  .sheet { height: 10in; display: flex; flex-direction: column; }
  .sheet.overflow { height: auto; }

  header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    padding-bottom: 0.7rem;
    border-bottom: 1.5px solid var(--ink);
  }
  h1 {
    margin: 0;
    font-family: 'Besley', Georgia, serif;
    font-size: 2.1rem;
    font-weight: 600;
    line-height: 1;
  }
  .range { font-size: 1rem; color: var(--muted); }

  .columns {
    flex: 1 0 auto;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 2.4in;
  }

  /* The week: seven rows sharing the page's spare height evenly */
  .week {
    display: grid;
    grid-template-rows: repeat(7, auto);
    align-content: stretch;
    padding-right: 0.3in;
  }
  .day {
    display: grid;
    grid-template-columns: 2.4rem minmax(0, 1fr);
    column-gap: 0.8rem;
    padding: 0.7rem 0;
    border-bottom: 1px solid var(--rule);
    break-inside: avoid;
  }
  .day:last-child { border-bottom: 0; }
  .date { display: flex; flex-direction: column; align-items: center; line-height: 1; }
  .weekday { font-size: 0.75rem; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }
  .num { font-family: 'Besley', Georgia, serif; font-size: 1.55rem; font-weight: 600; margin-top: 0.2rem; }
  .empty-day .weekday, .empty-day .num { color: var(--faint); }
  .meals { display: flex; flex-direction: column; gap: 0.75rem; padding-top: 0.1rem; }
  .meal h3 {
    margin: 0;
    font-family: 'Besley', Georgia, serif;
    font-size: 1.2rem;
    font-weight: 600;
    line-height: 1.25;
  }
  .meal-type { font-family: 'Schibsted Grotesk', system-ui, sans-serif; font-size: 0.85rem; font-weight: 400; color: var(--muted); }
  .ings {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    column-gap: 0.9rem;
    margin-top: 0.3rem;
  }
  .ings.have { margin-top: 0.2rem; color: var(--muted); }
  .box.checked { border-color: var(--faint); position: relative; }
  .box.checked::after {
    content: '';
    position: absolute;
    left: 0.2rem;
    top: 0.04rem;
    width: 0.18rem;
    height: 0.36rem;
    border: solid var(--muted);
    border-width: 0 1.5px 1.5px 0;
    transform: rotate(45deg);
  }

  /* The shopping list: the one place with checkboxes */
  .list { border-left: 1px solid var(--rule); padding: 0.7rem 0 0 0.3in; }
  .list h2 {
    margin: 0 0 0.8rem;
    font-family: 'Besley', Georgia, serif;
    font-size: 1.2rem;
    font-weight: 600;
    line-height: 1.25;
  }
  .store { margin-bottom: 1rem; break-inside: avoid; }
  .store h3 {
    margin: 0 0 0.3rem;
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
  }
  ul { list-style: none; margin: 0; padding: 0; }
  li { display: flex; align-items: baseline; gap: 0.55rem; font-size: 0.92rem; line-height: 1.4; padding: 0.15rem 0; }
  .box {
    flex-shrink: 0;
    width: 0.7rem;
    height: 0.7rem;
    border: 1.25px solid var(--ink);
    border-radius: 2px;
    transform: translateY(0.05rem);
  }
  .qty { color: var(--muted); white-space: nowrap; }
  .empty { margin: 0; font-size: 0.92rem; color: var(--muted); }

  @media print {
    body { background: #fff; }
    .paper { width: auto; height: auto; margin: 0; padding: 0; box-shadow: none; }
  }
</style>
</head>
<body>
<div class="paper">
<main class="sheet">
  <header>
    <h1>Meal Plan</h1>
    <span class="range">${escapeHtml(weekRangeLabel)}</span>
  </header>
  <div class="columns">
    <div class="week">${week.days.map(day => dayHtml(day, showType)).join('')}
    </div>
    <aside class="list">
      <h2>Shopping List</h2>
      ${shoppingHtml(week.shopping)}
    </aside>
  </div>
</main>
</div>
</body>
</html>`;
};

/** Smallest root size a busy week shrinks to before it spills onto page two. */
const MIN_ROOT_PX = 10;
const BASE_ROOT_PX = 13;

/**
 * Shrinks the sheet's type (every size is rem) until the week fits its one
 * Letter page. If even the minimum size overflows, the sheet drops its fixed
 * height so the rest flows onto a second page instead of being clipped.
 * Call after the document's fonts have loaded — they set the line heights.
 */
export const fitPrintSheet = (doc: Document): void => {
  const sheet = doc.querySelector<HTMLElement>('.sheet');
  if (!sheet) return;
  const root = doc.documentElement;
  for (let px = BASE_ROOT_PX; px >= MIN_ROOT_PX; px -= 0.5) {
    root.style.fontSize = `${px}px`;
    if (sheet.scrollHeight <= sheet.clientHeight + 1) return;
  }
  sheet.classList.add('overflow');
};
