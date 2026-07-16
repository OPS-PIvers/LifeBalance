# Product

## Register

product

## Users

Households (couples/families, including managed kid profiles via Kid Mode) managing shared money, habits, meals, shopping, and to-dos on their phones. Primary user today is the owner's own family; the roadmap targets strangers paying for it. Context of use: quick, one-handed phone sessions throughout the day — logging an expense at checkout, checking Safe-to-Spend before a purchase, ticking a habit at night, planning meals on the couch. It is a mobile-only PWA; there is no desktop layout.

## Product Purpose

LifeBalance combines finance tracking (Safe-to-Spend, pay-period budgeting, bills, buckets), gamified habit building (points, streaks, multipliers, rewards), and household coordination (meals, shopping, to-dos) in one app with real-time multi-device sync. Success = the household trusts the Safe-to-Spend number enough to base spending decisions on it, and daily habit/meal/shopping flows are fast enough to actually replace paper and memory.

## Brand Personality

Calm, editorial, trustworthy. "Editorial finance, not dashboard": a warm paper canvas, serif display voice (Besley, an 1845 Clarendon revival) for moments, restrained evergreen + amber two-pole accent system. Money is treated seriously; gamification is warm but never juvenile. Restraint over spectacle — flat surfaces, hairline borders, small radii, short consistent motion.

## Anti-references

- Generic AI-generated app look: purple gradients, glassmorphism/backdrop-blur, floating rounded-3xl cards, Inter everywhere (the pre-2026 design this app deliberately removed).
- Dense desktop finance dashboards (Mint/bank-portal aesthetics) — this is a phone app.
- Hierarchy built from shadow/blur instead of type + spacing + the two accents.
- Raw Tailwind default palettes (slate-*), raw hex, magic z-index values.

## Design Principles

1. **Editorial finance, not dashboard** — calm paper canvas, serif display voice; money is serious.
2. **Mobile-only, thumb-first** — bottom sheets over centered modals, ≥44px touch targets, single column, bottom nav + FAB.
3. **Hierarchy from type + spacing + two accents** — evergreen carries money/primary, amber carries habits/gamification; never blur or shadow.
4. **Primitives first, tokens only** — Section/SurfaceList/Row, Button, Drawer; no hand-rolled surfaces or raw hex.
5. **Restraint** — one shadow for heroes, small radii, 120–320ms motion, reduced-motion honored globally.

## Accessibility & Inclusion

WCAG AA target. Touch targets ≥44px; icon-only controls require aria-label; visible focus (`focus-visible:ring-2 ring-accent-500/40`); dialogs trap and restore focus, close on Escape/backdrop; `prefers-reduced-motion` suppresses all motion globally; first-class dark mode (every token has a paired dark variant); text contrast maintained on tinted chips/surfaces in both themes.
