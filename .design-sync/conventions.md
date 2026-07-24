# Building with the LifeBalance design system

LifeBalance is a warm, editorial household-management UI (finance + habits +
planning). Build on-brand by composing these real components and styling your
own layout glue with the token vocabulary below.

## Setup — almost never needs a provider

Nearly every primitive is self-contained: it reads no React context, theme, or
router, so you can render it directly. The only requirement is that the design
system's `styles.css` is loaded (it `@import`s the compiled tokens, fonts, and
component CSS). Dark mode is driven by a `dark` class on a `<html>`/ancestor
element — components already carry their `dark:` variants, so toggling that
class themes everything.

Two components DO read context, and both throw without it: **`SwipeActionRow`**
(reads the resolved theme to paint its swipe rails) and **`SectionActionLink`**
(renders a router `Link`). Wrap those — or the whole design, which is equally
safe — in the exported `AppProviders`:

```tsx
import { AppProviders, SwipeActionRow } from 'lifebalance';

<AppProviders>
  <SwipeActionRow endActions={[…]}>…</SwipeActionRow>
</AppProviders>
```

## Compound components (bundled, no card of their own)

Some primitives are families. The parent has the preview card; its parts are
importable from the same bundle:

| Card | Also exported |
|---|---|
| `Section` | `SurfaceList`, `Row`, `DisclosureRow`, `Stat`, `StatGroup` |
| `Tabs` | `TabsList`, `TabsTrigger`, `TabsContent` |
| `Skeleton` | `SkeletonText`, `SkeletonCard` |

`Section` + `SurfaceList` + `Row` is the app's core list idiom — a solid grouped
surface with 1px hairline dividers between rows, not a stack of floating cards.
Reach for it before `Card`.

## Styling idiom — Tailwind v4 utility classes

Style your own layout with Tailwind utility classes bound to LifeBalance's
tokens. **Use these token families — do not invent hex values or off-palette
colors:**

| Family | Use | Key steps |
|---|---|---|
| `brand-*` | Warm-paper neutrals: text, borders, surfaces | `bg-brand-50` page bg, `text-brand-500` muted, `border-brand-200`, `bg-brand-800` (dark surface) |
| `accent-*` | Evergreen — the PRIMARY brand color | `bg-accent-600` primary fill, `text-accent-700`, `bg-accent-50` tint |
| `warm-*` | Amber — reserve for **gamification** (habits, streaks, points), not general emphasis | `bg-warm-500`, `text-warm-700` |
| `money-*` | Financial semantics | `text-money-pos` / `bg-money-bgPos` (positive), `text-money-neg` / `bg-money-bgNeg` (negative) |
| `habit-*` | Streak/gold/blue accents | `text-habit-streak`, `text-habit-gold` |

**Fonts:** `font-display` (Besley — a Clarendon serif, for editorial titles and
big numbers), `font-sans` (Schibsted Grotesk — default body), `font-mono`
(Spline Sans Mono — money amounts, counts). **Radii:** `rounded-card`,
`rounded-btn`. **Surfaces:** prefer `surface-section` grouped-flat panels over
nesting `Card`s — LifeBalance is deliberately flat, compact, and mobile-first
(one `h1` masthead per page via `PageHeader`).

## Where the real truth lives

- `guidelines/DESIGN.md` — the full design language (color intent, typography
  voice, grouped-flat system, anti-patterns). Read it before styling.
- `styles.css` and its `@import` closure — every token and component class.
- Each component's `<Name>.prompt.md` (usage) and `<Name>.d.ts` (exact props).

## Idiomatic snippet

```tsx
import { PageHeader, Card, Button, Badge, ProgressBar } from 'lifebalance';

function BudgetSummary() {
  return (
    <div className="bg-brand-50 min-h-screen">
      <PageHeader title="Money" subtitle="$412.60 safe to spend" />
      <div className="px-4 space-y-3">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <span className="font-sans text-brand-700">Groceries</span>
            <Badge variant="warning">82%</Badge>
          </div>
          <ProgressBar value={82} className="mt-2 h-2 bg-brand-100"
            barClassName="bg-warm-500" ariaLabel="Groceries" />
          <span className="font-mono text-brand-500 text-sm">$492 / $600</span>
        </Card>
        <Button variant="primary" className="w-full">Add expense</Button>
      </div>
    </div>
  );
}
```
