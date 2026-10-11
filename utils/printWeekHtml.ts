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
  quantity || quantity === 0 ? `<span class="qty">${escapeHtml(quantity)}</span>` : '';

// Three day tags fit beside an item; past that a count reads faster.
const forDaysLabel = (days: string[]): string =>
  days.length > 3 ? `${days.length} days` : days.map(escapeHtml).join(' ');

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`;

const mealHtml = (meal: PrintMeal, showType: boolean): string => {
  const status = !meal.hasIngredients
    ? ''
    : meal.toBuy.length > 0
      ? `<span class="status">${meal.toBuy.length} to buy</span>`
      : '<span class="status done"><span class="tick">✓</span> All on hand</span>';

  const buy = meal.toBuy.length
    ? `<ul class="buy">${meal.toBuy
        .map(ing => `<li><span class="box"></span><span class="ing">${escapeHtml(ing.name)}${qtyHtml(ing.quantity)}</span></li>`)
        .join('')}</ul>`
    : '';

  const have = meal.onHand.length
    ? `<p class="have"><span class="have-label"><span class="tick">✓</span> On hand</span> ${meal.onHand
        .map(ing => escapeHtml(ing.name))
        .join(', ')}</p>`
    : '';

  return `
        <article class="meal">
          ${showType ? `<p class="meal-type">${escapeHtml(meal.typeLabel)}</p>` : ''}
          <div class="meal-head"><h3>${escapeHtml(meal.mealName)}</h3>${status}</div>
          ${buy}${have}
        </article>`;
};

const dayHtml = (day: PrintDay, showType: boolean): string => `
      <section class="day${day.meals.length ? '' : ' empty-day'}">
        <div class="date"><span class="weekday">${escapeHtml(day.weekday)}</span><span class="num">${escapeHtml(day.dayOfMonth)}</span></div>
        <div class="meals">${day.meals.map(meal => mealHtml(meal, showType)).join('') || '<span class="write-in"></span>'}</div>
      </section>`;

const shoppingHtml = (stores: PrintShoppingStore[]): string =>
  stores.length
    ? stores
        .map(
          store => `
      <section class="store">
        <h3>${escapeHtml(store.storeLabel)}</h3>
        ${store.categories
          .map(
            category => `
        <h4>${escapeHtml(category.display)}</h4>
        <ul class="items">
          ${category.items
            .map(
              item =>
                `<li><span class="box"></span><span class="ing">${escapeHtml(item.name)}${qtyHtml(item.quantity)}</span>${
                  item.forDays.length ? `<span class="for">${forDaysLabel(item.forDays)}</span>` : ''
                }</li>`
            )
            .join('')}
        </ul>`
          )
          .join('')}
      </section>`
        )
        .join('')
    : '<p class="empty">Nothing on the list.</p>';

/**
 * Builds a standalone, chrome-free HTML document for the fridge-friendly
 * "Print week" view: one US Letter page with every day of the week down the
 * left (each meal's ingredients split into still-to-buy checkboxes and an
 * on-hand line) and the shopping list down the right. Self-contained (inline
 * `<style>`, no external stylesheet) so it renders correctly in the popup
 * window it's opened into. Sizes are in rem so `fitPrintSheet` can shrink a
 * busy week onto the one page.
 */
export const buildPrintWeekHtml = (weekRangeLabel: string, week: PrintWeek): string => {
  // Meal-type labels only earn their ink when the week mixes types; a week of
  // dinners would otherwise repeat "Dinner" on every row.
  const showType = week.days.some(day => day.meals.some(meal => meal.typeLabel !== 'Dinner'));

  const summary = week.mealCount
    ? `${plural(week.mealCount, 'meal')} · ${plural(week.toBuyCount, 'item')} to buy`
    : 'No meals planned yet';

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
  @page { size: letter portrait; margin: 0.45in; }
  :root {
    --ink: #161512;
    --muted: #655f55;
    --faint: #8a8377;
    --rule: #d6d1c7;
    --accent: #285742;
    font-size: 13px;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body {
    font-family: 'Schibsted Grotesk', system-ui, sans-serif;
    color: var(--ink);
    background: #e8e5de;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .paper {
    width: 8.5in;
    height: 11in;
    margin: 24px auto;
    padding: 0.45in;
    background: #fff;
    box-shadow: 0 1px 3px rgba(0,0,0,.12), 0 8px 24px rgba(0,0,0,.08);
  }
  .sheet {
    height: 10.1in;
    display: flex;
    flex-direction: column;
  }
  .sheet.overflow { height: auto; }

  /* Masthead */
  .masthead {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 1rem;
    padding-bottom: 0.6rem;
    border-bottom: 2px solid var(--ink);
  }
  h1 {
    font-family: 'Besley', Georgia, serif;
    font-size: 2.3rem;
    line-height: 1;
    font-weight: 600;
    letter-spacing: -0.01em;
    margin: 0;
  }
  .range {
    margin: 0.35rem 0 0;
    font-size: 0.85rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .key { text-align: right; font-size: 0.8rem; color: var(--muted); line-height: 1.5; }
  .key .summary { color: var(--ink); font-weight: 600; font-size: 0.9rem; }
  .key .legend { display: flex; gap: 0.9rem; justify-content: flex-end; align-items: center; }
  .key .legend span { display: inline-flex; align-items: center; gap: 0.3rem; }

  /* Two columns: the week, then the list */
  .columns {
    flex: 1 0 auto;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 2.7in;
  }
  .week { display: flex; flex-direction: column; padding-right: 0.25in; }
  .day {
    flex: 1 0 auto;
    display: grid;
    grid-template-columns: 2.6rem minmax(0, 1fr);
    column-gap: 0.7rem;
    padding: 0.55rem 0;
    border-bottom: 1px solid var(--rule);
    break-inside: avoid;
  }
  .day:last-child { border-bottom: 0; }
  .date { display: flex; flex-direction: column; align-items: center; line-height: 1; padding-top: 0.1rem; }
  .weekday {
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .num {
    font-family: 'Besley', Georgia, serif;
    font-size: 1.65rem;
    font-weight: 600;
    margin-top: 0.15rem;
  }
  .empty-day .num, .empty-day .weekday { color: var(--faint); }
  .meals { display: flex; flex-direction: column; gap: 0.55rem; }
  .write-in { display: block; height: 1.6rem; border-bottom: 1px dotted var(--rule); }
  .meal-type {
    margin: 0 0 0.1rem;
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .meal-head { display: flex; align-items: baseline; justify-content: space-between; gap: 0.75rem; }
  .meal-head h3 {
    margin: 0;
    font-family: 'Besley', Georgia, serif;
    font-size: 1.2rem;
    font-weight: 600;
    line-height: 1.2;
  }
  .status {
    flex-shrink: 0;
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--ink);
  }
  .status.done, .tick { color: var(--accent); }
  .tick { font-weight: 700; }

  ul { list-style: none; margin: 0; padding: 0; }
  ul.buy {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    column-gap: 1rem;
    margin-top: 0.3rem;
  }
  li {
    display: flex;
    align-items: baseline;
    gap: 0.45rem;
    font-size: 0.92rem;
    line-height: 1.3;
    padding: 0.12rem 0;
    break-inside: avoid;
  }
  .ing { flex: 1; min-width: 0; }
  .qty { color: var(--muted); margin-left: 0.35rem; font-size: 0.85em; }
  .box {
    flex-shrink: 0;
    width: 0.72rem;
    height: 0.72rem;
    border: 1.5px solid var(--ink);
    border-radius: 2px;
    transform: translateY(0.08rem);
  }
  .have {
    margin: 0.3rem 0 0;
    font-size: 0.85rem;
    line-height: 1.4;
    color: var(--muted);
  }
  .have-label {
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    margin-right: 0.25rem;
    color: var(--ink);
  }

  /* Shopping list */
  .list {
    border-left: 1px solid var(--rule);
    padding: 0.55rem 0 0 0.25in;
  }
  .list h2 {
    margin: 0 0 0.5rem;
    font-family: 'Besley', Georgia, serif;
    font-size: 1.35rem;
    font-weight: 600;
  }
  .store { margin-bottom: 0.8rem; break-inside: avoid; }
  .store h3 {
    margin: 0 0 0.2rem;
    padding-bottom: 0.2rem;
    border-bottom: 1px solid var(--ink);
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  .store h4 {
    margin: 0.4rem 0 0.05rem;
    font-size: 0.72rem;
    font-weight: 600;
    color: var(--muted);
  }
  .for {
    flex-shrink: 0;
    font-size: 0.68rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--faint);
  }
  .empty { margin: 0; font-size: 0.9rem; color: var(--muted); font-style: italic; }

  @media print {
    body { background: #fff; }
    .paper { width: auto; height: auto; margin: 0; padding: 0; box-shadow: none; }
  }
</style>
</head>
<body>
<div class="paper">
<main class="sheet">
  <header class="masthead">
    <div>
      <h1>Meal Plan</h1>
      <p class="range">${escapeHtml(weekRangeLabel)}</p>
    </div>
    <div class="key">
      <div class="summary">${summary}</div>
      <div class="legend"><span><span class="box"></span> Still to buy</span><span><span class="tick">✓</span> On hand</span></div>
    </div>
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
