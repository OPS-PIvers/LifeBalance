# LifeBalance — Design System

The single source of truth for how LifeBalance looks and feels. It documents the
identity that shipped in the 2026 visual refresh. **Tokens are defined in
[`index.css`](index.css) under `@theme`** (Tailwind CSS v4 — there is no
`tailwind.config.js`); this file explains how to *use* them.

> If a screen looks like a generic AI-generated app — purple gradients, glass
> blur, floating rounded-3xl cards, Inter — it is **off-spec**. See
> [§11 Anti-patterns](#11-anti-patterns).

---

## 1. Principles

1. **Editorial finance, not dashboard.** A calm, paper-like canvas with a serif
   display voice. Money is serious; the type treats it that way.
2. **Mobile-only.** This is a phone PWA. Dialogs are **bottom sheets**, touch
   targets are ≥44px, layouts are single-column. There is no desktop layout to
   design for.
3. **Hierarchy from type + spacing + two accents — never from blur or shadow.**
   Default surfaces are flat with a hairline border. Elevation is rare.
4. **Two-pole accent system.** Deep **evergreen** carries money/primary actions;
   warm **amber** carries habits/household/gamification. Everything else is the
   warm-paper neutral ramp.
5. **Restraint.** Small deliberate radii, one shadow reserved for hero surfaces,
   short consistent motion. When in doubt, do less.

---

## 2. Color

All colors are CSS variables in `@theme`; use the Tailwind utility (`bg-accent-600`,
`text-brand-500`, `border-brand-200`) — **never raw hex in components.**

### Neutrals — `brand-*` (warm "paper", replaces raw slate)

| Token | Hex | Typical use |
|---|---|---|
| `brand-50` | `#f8f7f4` | App background (light); input fill |
| `brand-100` | `#f0eee9` | Hover fill; muted chip bg |
| `brand-200` | `#e3e0d8` | **Default hairline border (light)** |
| `brand-300` | `#cbc7bb` | Drag handles; dashed borders |
| `brand-400` | `#767165` light / `#a8a399` dark | Placeholder / tertiary text; idle icons |
| `brand-450` | `#6e685d` light / `#94907f` dark | Muted/hint half-step between 400 and 500 |
| `brand-500` | `#655f55` light / `#7c776c` dark | Secondary text |
| `brand-600` | `#565249` | Body text (light, secondary surfaces) |
| `brand-700` | `#3a3731` | Borders (dark); strong text |
| `brand-800` | `#242220` | **Surface background (dark)** |
| `brand-900` | `#161512` | App background (dark); backdrops at 60% |

### Primary accent — `accent-*` (EVERGREEN)

Finance, primary buttons, active nav, the FAB, focus rings, links.

| Token | Hex | Use |
|---|---|---|
| `accent-50` | `#eef3ef` | Subtle active/selected fill |
| `accent-100` | `#d8e6dd` | Selected chip fill |
| `accent-200` | `#b3cdbd` | Selected chip border |
| `accent-500` | `#356f54` | Focus ring (`ring-accent-500/40`); dark primary btn |
| **`accent-600`** | **`#285742`** | **PRIMARY — buttons, FAB, active states** |
| `accent-700` | `#214636` | Primary hover; link hover |
| `accent-800/900` | `#1a382b` / `#122618` | Deep fills, dark tints |

### Secondary accent — `warm-*` (AMBER)

Habits, household, gamification, streaks.

| Token | Hex | Use |
|---|---|---|
| `warm-50` | `#faf4ea` | Subtle habit/household tint |
| `warm-100/200` | `#f4e6cf` / `#e9cb9f` | Habit chip fill/border |
| **`warm-500`** | **`#b87a29`** | **PRIMARY — habit emphasis, icons, fills** |
| `warm-600` | `#97611f` | Warm text on light (AA); `warning` button bg |
| `warm-700` | `#744a1b` | Warning button hover |

Amber text on light surfaces uses `warm-600`+ (`warm-500` is 3.6:1 on white —
fine for icons/fills, below AA for text).

### Semantic — money & habits

| Token | Hex | Use |
|---|---|---|
| `money-pos` | `#1b7f57` light / `#1f8f63` dark | Positive amounts, success |
| `money-neg` | `#c93e35` light / `#d4483f` dark | Negative amounts, destructive |
| `money-bgPos` | `#eef6f1` | Positive row/chip tint |
| `money-bgNeg` | `#fbeeec` | Destructive hover/tint |
| `habit-streak` | `#ea6a26` | Streak flame |
| `habit-gold` | `#e0a32a` | Points / reward gold |
| `habit-blue` | `#5a8a86` | Slate-teal habit accent (not sky blue) |

**Rule:** money values use `money-pos`/`money-neg`. Primary actions use `accent`.
Habit/household flourishes use `warm`/`habit-*`. Don't cross these wires.

---

## 3. Typography

Three self-hosted variable fonts (woff2, `font-display: swap`, per-subset
`unicode-range`). **No Inter, no JetBrains Mono.**

| Token | Family | Role |
|---|---|---|
| `font-display` | **Besley** (Clarendon serif, 400–600) | Greetings, section titles, hero numbers, dialog titles |
| `font-sans` | **Schibsted Grotesk** (400–700) | All UI text (default) |
| `font-mono` | **Spline Sans Mono** (400–600) | Tabular numerals where alignment matters |

### Usage rules

- **Display (`font-display`) is for moments, not paragraphs:** page greeting
  ("Hi, Paul Ivers"), `Section` titles, the Safe-to-Spend figure, dialog titles.
  Pair with `tracking-tight` and `font-semibold`.
- **Body and controls are `font-sans`** (the default — no class needed).
- **Section header** (`Section` primitive): `font-display text-sm font-semibold
  tracking-tight text-brand-700 dark:text-brand-200`.
- **Eyebrow / field label:** `text-xs font-bold uppercase tracking-wider
  text-brand-400 dark:text-brand-500`. Micro-labels use `text-xxs` (10px).
- **Page title:** `font-display text-2xl font-semibold tracking-tight`.

---

## 4. Spacing, radius, elevation, motion

### Radius (deliberate, small)

| Token | Value | Use |
|---|---|---|
| `rounded-sm` | 0.375rem | Inline controls, segmented-control items |
| `rounded-btn` | 0.5rem | Buttons, inputs |
| `rounded-card` | 0.75rem | Cards / dialog bodies (`surface-section` uses `rounded-2xl`) |
| `rounded-lg` | 1rem | **Hero surfaces only** |
| `rounded-full` | — | Chips, pills, checkboxes, icon buttons |

Avoid `rounded-3xl` and larger — they read as the old "floating card" slop.

### Elevation (rare)

Default surfaces have **a hairline border and NO shadow.** Only opt into shadow
for hero surfaces.

| Token | Use |
|---|---|
| `shadow-raised` | Hero surfaces only (Safe-to-Spend hero, dialogs) |
| `shadow-nav` | Bottom nav top edge |
| `shadow-btn-primary` / `-hover` | Primary/`success`/`warning`/`destructive` buttons |
| `shadow-btn-secondary` | Secondary button |

No `backdrop-blur`. No bespoke `shadow-[...]`. No `shadow-premium`/glass (removed).

### Motion

| Token | Value |
|---|---|
| `--duration-fast` | 120ms (press, hover, tab swap) |
| `--duration-base` | 200ms (dialog/route fade, list enter) |
| `--duration-slow` | 320ms (larger reveals) |
| `--ease-standard` | `cubic-bezier(0.2,0,0,1)` |

Use as `duration-(--duration-fast) ease-(--ease-standard)`. Entrance animations
come from `tailwindcss-animate` (`animate-in fade-in …`). **All motion is
suppressed under `prefers-reduced-motion`** (global guard in `index.css` +
`useReducedMotion` for Framer Motion). Always honor it.

### Z-index scale

`sticky 40` · `dropdown 50` · `banner 55` · `modal 60` · `popover 70` ·
`toast 110`. Use the tokens (`z-modal`, `z-popover`) — never magic numbers.

---

## 5. Surfaces & layout (grouped-flat)

The canonical way to present content is **grouped-flat sections** (iOS Settings /
Things / Copilot Money), via the primitives in
[`components/ui/Section.tsx`](components/ui/Section.tsx):

```tsx
<Section title="Recent activity" action={<a>View all</a>}>
  <SurfaceList>
    <Row interactive>…</Row>
    <Row>…</Row>
  </SurfaceList>
</Section>
```

- **`surface-section`** utility = `bg-white dark:bg-brand-800` + hairline border +
  `rounded-2xl`, **no shadow**. The base for any panel.
- **`SurfaceList`** = a `surface-section` that clips its rows; the first row's top
  hairline is auto-suppressed.
- **`Row`** = `flex items-center gap-3 px-4` with a top **`hairline-divider`**;
  `py-3.5` default / `py-2.5` when `dense`; add `interactive` for hover/press.
- Rows are separated by **1px hairlines, not gaps between floating cards.**
- Page padding: `px-4`; vertical rhythm between sections: `space-y-4`/`space-y-6`.

---

## 6. Components

### Buttons — [`components/ui/Button.tsx`](components/ui/Button.tsx)

Always use `<Button>`; don't hand-roll. Base: `rounded-btn font-semibold
tracking-tight`, `active:scale-[0.98]`, focus ring `ring-accent-500/40`.

- **Variants:** `primary` (evergreen, default), `secondary` (white + hairline),
  `ghost`, `outline`, `dashed`, `subtle` (accent tint), `link`, `success`,
  `warning` (amber), `destructive`/`danger`/`ghost-danger`/`ghost-destructive`,
  `ghost-brand`, `ghost-inverted`.
- **Sizes:** `sm` `md`(default) `lg` `icon` `icon-sm`.
- One primary action per view. Destructive actions use the destructive family.

### Chips / badges

Pill shape, hairline border, compact text. Canonical:
`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xxs`
(or `px-3 py-1.5 text-xs` for tappable chips). Color comes from a token trio
(`{bg} {text} {border}`) — accent for selected, `brand-100/brand-500/brand-200`
for neutral, semantic tints for money/store/quick-list. Don't invent per-chip hex.

### Inputs

`w-full p-3 rounded-btn bg-brand-50 border border-brand-200 focus:ring-2
focus:ring-accent-500/40 focus:border-accent-500` (dark: `bg-brand-700/50
border-brand-600`). Placeholder `text-brand-400`. Label uses the eyebrow style
(§3). Match this for every text field, select, and textarea.

### Dialogs — **bottom sheets first** (mobile-only)

| Primitive | When |
|---|---|
| **`Drawer`** ([ui/Drawer.tsx](components/ui/Drawer.tsx)) | **Default for all forms, pickers, wizards, lists, info panels.** Slides up, drag-to-dismiss handle, `height='auto'\|'tall'`, focus-trapped, `dvh`-aware so it sits above the iOS keyboard. |
| **`ConfirmDialog`** ([ui/ConfirmDialog.tsx](components/ui/ConfirmDialog.tsx)) | Small yes/no destructive or affirmative alerts only. A centered card is correct here. |
| **`Modal`** ([ui/Modal.tsx](components/ui/Modal.tsx)) | Legacy centered card. **Do not use for new work** — it floats mid-screen on a phone. Existing usages are being migrated to `Drawer`. |
| Anchored **Popover/Menu** | Small trigger-anchored menus (3–6 items, filter dropdowns). Stay anchored; don't promote to a sheet. |

All dialog titles use `font-display`. Backdrop is `bg-brand-900/60` (no blur).

### Bottom navigation

Four destinations — **Home · Habits · Money · Plan** — with a centered evergreen
**FAB**. Active item uses `accent`. Routes keep their paths (`/budget`, `/lists`);
only the labels are these.

### Iconography

[lucide-react](https://lucide.dev). Sizes: 16 (inline/dense), 18–20 (actions),
24 (nav). Idle icons `text-brand-400`; meaningful icons take a semantic color.

---

## 7. Dark mode

First-class, via the `.dark` class (`@custom-variant dark`). Every surface, text,
and border token has a dark counterpart — always pair them
(`bg-white dark:bg-brand-800`, `text-brand-900 dark:text-brand-50`,
`border-brand-200 dark:border-brand-700`). Never ship a light-only color.

---

## 8. Accessibility

- Touch targets ≥44px; icon-only controls need `aria-label`.
- Focus is always visible: `focus-visible:ring-2 ring-accent-500/40`
  (`ring-offset-2` on solid buttons). Never remove outlines without a replacement.
- Dialogs trap focus, restore it on close, and close on Escape/backdrop
  (the primitives handle this — reuse them).
- Honor `prefers-reduced-motion` (handled globally + `useReducedMotion`).
- Maintain text contrast on tinted chips/surfaces in both themes.

---

## 9. Numbers & money

- Currency and aligned figures use `font-mono` (Spline Sans Mono) for tabular feel.
- Sign-color amounts with `money-pos` / `money-neg`.
- Sum money in integer cents ([utils/money.ts](utils/money.ts)) — never floats.

---

## 10. Adding new UI — checklist

1. Reach for a **primitive first** (`Section`/`SurfaceList`/`Row`, `Button`,
   `Drawer`, inputs). Don't hand-roll surfaces, buttons, or dialogs.
2. Use **tokens only** — no raw hex, no magic z-index, no bespoke shadows.
3. New dialog? It's a **`Drawer`** unless it's a tiny confirm (`ConfirmDialog`)
   or an anchored menu (Popover).
4. Provide **dark variants** and an **`aria-label`** for icon buttons.
5. Use the **motion tokens**; verify reduced-motion.
6. Default to **flat + hairline**; reserve `shadow-raised`/`rounded-lg` for heroes.

---

## 11. Anti-patterns (never reintroduce)

These are the "generic AI slop" markers the redesign removed:

- ❌ **Purple** anything (the old brand). Primary is evergreen `accent-600`.
- ❌ **Glassmorphism / `backdrop-blur` / translucent floating cards.**
- ❌ **Inter / JetBrains Mono.** Use Besley / Schibsted Grotesk / Spline Sans Mono.
- ❌ **Raw `slate-*`** (or other default Tailwind palettes). Use `brand-*`.
  > ⚠️ Token-swapping `slate`→`brand` must be word-bounded (`(^|[^a-z])slate-[0-9]`);
  > a blind replace once corrupted `tran[slate]-y` → `tranbrand-y`. Never do a bare
  > `slate`→`brand` find/replace.
- ❌ **`rounded-3xl`+ floating cards** and **`shadow-premium`/ad-hoc shadows.**
- ❌ **Centered `Modal` for new dialogs** on this phone-only app — use `Drawer`.
- ❌ **Raw hex colors / magic z-index** in components — use tokens.
- ❌ Hierarchy built from shadow/blur instead of type + spacing + the two accents.

---

## Appendix — token quick reference

Defined in [`index.css`](index.css) `@theme`:

```
Fonts    --font-display (Besley) · --font-sans (Schibsted Grotesk) · --font-mono (Spline Sans Mono)
Neutral  brand-50 … brand-900            (warm paper)
Primary  accent-50 … accent-900          (evergreen; 600 = PRIMARY)
Warm     warm-50 … warm-900              (amber; 500 = PRIMARY)
Money    money-pos / money-neg / money-bgPos / money-bgNeg
Habit    habit-streak / habit-gold / habit-blue
Radius   sm .375 · btn .5 · card .75 · lg 1rem (hero)
Shadow   shadow-raised (hero) · shadow-nav · shadow-btn-primary[-hover] · shadow-btn-secondary
Motion   --duration-fast 120 · base 200 · slow 320 · --ease-standard
Z-index  sticky 40 · dropdown 50 · banner 55 · modal 60 · popover 70 · toast 110
Misc     --text-xxs 10px · --spacing-safe (safe-area-inset-bottom)
Utils    surface-section · hairline-divider · scroll-contain-y · no-scrollbar · skeleton
```
