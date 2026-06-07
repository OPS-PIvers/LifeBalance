# Handoff: `animate-in` entrance-animation classes are no-ops (dead utilities)

**Status:** Not started · **Priority:** Low (cosmetic) · **Risk:** Low–Medium (adding motion is a behavior change + needs reduced-motion handling)

---

## Finding

Many components use `animate-in`, `fade-in`, `slide-in-from-top-4`/`-bottom-4`, and `zoom-in-95`
(e.g. `components/ui/Modal.tsx`, most dashboard widgets, several modals). These utilities come from
the **`tailwindcss-animate`** plugin (or the old Tailwind Play CDN). That plugin is **not installed
and not configured** in `tailwind.config.js`, and the utilities aren't defined in `index.css`.

Verified: the built CSS (`dist/assets/*.css`) defines only `@keyframes pulse`, `spin`, and
`skeleton-shimmer`; there is **no** `.animate-in` rule and no `enter`/`slide`/`zoom` keyframes. So
these classes currently render **nothing** — the intended entrance animations silently do not run.

This was almost certainly an unintended regression when the project moved from the Tailwind CDN to
a compiled PostCSS pipeline.

## Why this is deferred (not "fixed" in the optimization pass)

The optimization pass preserves runtime behavior. The *current* behavior is "no entrance
animation." Actually enabling these animations is a **new** user-visible behavior, not an
optimization, and it would re-introduce motion that must then be gated for
`prefers-reduced-motion` users — which is why finding #37 (a reduced-motion sweep) was a no-op:
there is no CSS motion to suppress today.

## Options

1. **Embrace the current state (cheapest):** remove the dead `animate-in*` classes from JSX so the
   intent is honest and class strings are smaller. No visual change.
2. **Restore the animations:** add `tailwindcss-animate` (`pnpm add -D tailwindcss-animate`) and
   register it in `tailwind.config.js` `plugins`. Then the existing classes work. You MUST also:
   - confirm the global reduced-motion guard in `index.css` neutralizes the new enter transforms
     (it currently sets `animation-duration: 0.01ms` for reduced motion, which makes them
     imperceptible — verify, or reset the plugin's `--tw-enter-*` vars in the guard), and
   - sanity-check bundle size and that nothing relies on the elements being instantly in place.

## Acceptance criteria

- Either: no dead `animate-in*` classes remain in the codebase (option 1), OR the animations
  actually render AND are fully suppressed under `prefers-reduced-motion` (option 2).
- `pnpm build` clean; no regression in tests.
