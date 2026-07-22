# Phase 2b — Deterministic Natural-Language Quick-Add (minimize Gemini)

> **Status:** planned / not started. This is the deferred follow-up to the
> capture-review-routing feature (Phase 1, shipped in PR #1062). A fresh agent
> session should be able to execute this end-to-end from this document alone.

## 1. Goal

Today a natural-language ("NL") quick-add capture (iOS Shortcut voice command,
etc.) is handled as: the `quickAddNaturalLanguage` HTTP endpoint keyword-routes
the raw text, parks it in `households/{id}/pendingItems`, and the **client**
later drains that queue by calling **Gemini** (`parseNaturalLanguageCommand`) to
parse + create the item on next app open.

Phase 2b replaces that with **deterministic server-side parsing** so Gemini is
**not called on the common path**. The Phase-1 capture-review drawer is the
safety net that makes cheaper heuristic parsing acceptable (the user fixes any
mis-parse in the drawer). Gemini becomes an **opt-in** "✨ Clean up with AI"
button for genuinely ambiguous input only.

This directly delivers the product ask: "reduce Gemini API calls as much as
possible."

## 2. What already exists — REUSE, do not rebuild

**Phase 1 (merged):**
- `Household.captureReview?: Partial<Record<'expense'|'shopping'|'todo','auto'|'review'>>` — per-type routing.
- Read helpers: `utils/captureReview.ts` (`getCaptureReviewMode`, `isManualReview`) and the **server twin** `functions/src/quickAdd/captureReview.ts` (same API, takes the raw `captureReview` map). Per-type defaults: `expense→'review'`, `shopping→'auto'`, `todo→'auto'`. **Keep the twins in sync.**
- `needsReview?: boolean` on `ShoppingItem` / `ToDo` — held-for-review flag; hidden from the normal lists via the provider-level split in `contexts/FirebaseHouseholdContext.tsx` (`visibleShoppingList`/`shoppingAwaitingReview`, `visibleTodos`/`todosAwaitingReview`), mirrored in `contexts/MockHouseholdContext.tsx`.
- `approveShoppingItem(id, overrides?)` / `approveTodo(id, overrides?)` — clear `needsReview` + apply edits (on `useShopping()` / `useTodos()`).
- Review drawer: `components/modals/ReviewPendingDrawer.tsx` — a **controlled mixed-type cycler**, props `{ items: ReviewQueueItem[]; isOpen; onClose }`. `ReviewQueueItem` + `buildReviewQueueSnapshot(...)` live in `utils/reviewQueue.ts`:
  ```ts
  type ReviewQueueItem =
    | { kind:'transaction'; id:string; transaction:Transaction }
    | { kind:'shopping';     id:string; item:ShoppingItem }
    | { kind:'todo';         id:string; item:ToDo };
  ```
- Per-item forms: `components/transactions/ShoppingReviewForm.tsx`, `TodoReviewForm.tsx`, and the existing `TransactionReviewForm.tsx` (contract `{ item/transaction, onDone, onDeleted? }`).
- Dashboard aggregate: `components/dashboard/ReviewQueueCard.tsx` opens the drawer for held shopping/todo (gated on `isPlanTabVisible`).

**Phase 2a (merged, currently UNUSED — this phase wires them in):**
- `functions/src/quickAdd/shoppingParser.ts` → `parseShoppingPhrase(text: string, categories: string[]): { items: Array<{item:string; quantity:number; category:string}> }`.
- `functions/src/quickAdd/expenseSentenceParser.ts` → `parseExpenseSentence(text: string, opts?: { categories?: string[]; today?: string }): { amount:number|null; merchant:string|null; date:string|null; category:string|null; notes:string|null }`.
- To-dos already have the richer `functions/src/quickAdd/todoParser.ts` → `parseTodoPhrase(text)` (due date/time/reminder/importance).

## 3. Current NL path to rework (anchors — locate by symbol, lines may shift)

- **Server:** `functions/src/quickAdd/index.ts` — `detectCommandType(text)` (keyword router → `'shopping'|'todo'|'expense'|'unknown'`) and `quickAddNaturalLanguage` (writes a `PendingItem` `{text,type,source,createdAt,processed:false}` to `pendingItems`). The dedicated endpoints `quickAddShoppingItem` / `quickAddTodo` / `quickAddExpense` already contain the deterministic write + dedup + account-matching logic to reuse.
- **Client:** `contexts/FirebaseHouseholdContext.tsx` — the `pendingItems` `onSnapshot` listener + `drainPendingItemQueue(hid)` which calls `parseNaturalLanguageCommand` (Gemini, dynamic-imported from `@/services/geminiService`) and routes to `handleShoppingItems` / `handleTodoItems` / `handleExpense`.
- **Gemini call (keep, but make opt-in):** `services/geminiService.ts` `parseNaturalLanguageCommand(householdId, text, type, categories)` → `NaturalLanguageResult` union (`detectedType` + fields). Loads the `@google/genai` SDK via dynamic `import()`; keep it off the boot path.

## 4. Settled design decisions

1. **Deterministic-only common path; zero automatic Gemini calls.**
2. **Confident type** (shopping/todo/expense from the router) → parse deterministically server-side and **write directly** to the target collection, stamping `needsReview` per the household's `captureReview` setting for that resolved type (reuse the same held/visible-bucket dedup rule as `quickAddShoppingItem`). Expenses always land `status:'pending_review'` (+ `needsAmount:true` when the parser returns no amount).
3. **Unknown / ambiguous** → keep a `pendingItem` (type `'unknown'`) and surface it in the **review drawer as an "unclassified" card**: the user picks a type + edits fields, then creates it; an **opt-in "✨ Clean up with AI"** button runs `parseNaturalLanguageCommand` (Gemini) to auto-classify+parse and pre-fill the form.
4. **NL-resolved items respect the same per-type review setting** as the dedicated endpoints (consistency).
5. **Remove the automatic client-side Gemini drain.** The `pendingItems` listener stays, but only to feed unclassified cards — it never auto-calls Gemini.

## 5. Layers (suggested sequence; adversarially review before merge)

### P2b-1 — Server: rework `quickAddNaturalLanguage` (`functions/src/quickAdd/index.ts`)
- Harden `detectCommandType` into a **scoring** router (count signals per type; tie-break on a price token / imperative verb). Fixes the current first-match-wins pitfalls (e.g. "buy milk … $5" → shopping). Keep `'unknown'` for genuine ambiguity.
- Route:
  - **todo** → `parseTodoPhrase` (+ split multi-task on "and"/comma, default priority `medium`, resolve assignee via `todoMatch.fuzzyMatchMember`) → write to `todos` with `needsReview` per `isManualReview(captureReview,'todo')`.
  - **shopping** → `parseShoppingPhrase(text, categories)` (categories from the household doc's `groceryCategories`) → write each item to `shoppingList` with `needsReview` per `isManualReview(captureReview,'shopping')`, using the **same held/visible-bucket dedup** as `quickAddShoppingItem`.
  - **expense** → `parseExpenseSentence(text,{categories,today})` → write to `transactions` as `pending_review` (+ `needsReview`/`needsAmount` handling and account matching like `quickAddExpense`; reuse `accountMatch`/`normalizeUsDate`).
  - **unknown** → write a `PendingItem` `{type:'unknown', processed:false}` (as today) for the client to surface.
- Preserve the existing per-type permission gating. Add unit tests in `functions/src/quickAdd/index.test.ts` for each route + the unknown fallback.
- Consider extracting the reusable per-type "build + dedup + write" bodies so both the dedicated endpoints and the NL endpoint share them (avoid divergence).

### P2b-2 — Client: remove auto-Gemini drain; expose unclassified items (`contexts/FirebaseHouseholdContext.tsx`)
- Delete/neuter `drainPendingItemQueue`'s Gemini call and the `handleShoppingItems`/`handleTodoItems`/`handleExpense` auto-processing.
- Keep the `pendingItems` listener; expose **unprocessed `type:'unknown'`** pending items as a new awaiting list (e.g. `unclassifiedCaptures`) on a context slice for the drawer. Legacy already-typed `pendingItems` (from before this change) should also surface as unclassified cards (or be one-time drained without Gemini) — document whichever you choose.
- Mirror in `MockHouseholdContext.tsx`.

### P2b-3 — Drawer: unclassified card + opt-in AI button
- Add a `{ kind:'pendingItem'; id; pending:PendingItem }` variant to `ReviewQueueItem` (`utils/reviewQueue.ts`) and include unclassified captures in the snapshots built by `MainLayout` + `ReviewQueueCard`.
- New `components/transactions/UnclassifiedReviewForm.tsx` (contract `{ item: PendingItem; onDone; onDeleted? }`): shows the raw text, a **type picker** (shopping / to-do / expense) via `SegmentedControl`, editable fields for the chosen type, and a **create** action that calls the right approve/create path; plus a **"✨ Clean up with AI"** button that dynamically imports and calls `parseNaturalLanguageCommand`, then pre-fills the form from the result. On create/discard, mark the `pendingItem` processed.
- Keep `Drawer`/`framer-motion`/the Gemini SDK **off the boot path** (lazy, per CLAUDE.md "Code-Splitting & Boot Bundle").

## 6. Reuse map
`detectCommandType`, `parseTodoPhrase`, `parseShoppingPhrase`, `parseExpenseSentence`, `accountMatch.normalizeUsDate`/`matchAccountByLast4`, `todoMatch.fuzzyMatchMember`, the `captureReview` server twin, the held/visible-bucket dedup from `quickAddShoppingItem`, and `parseNaturalLanguageCommand` (**opt-in only**).

## 7. Constraints & verification (per CLAUDE.md)
- pnpm only; `@/` alias for app cross-dir imports (functions/ uses relative imports); TypeScript strict + `noUncheckedIndexedAccess`; **zero lint/type suppressions**; tests next to code; Tailwind-v4 tokens + existing `components/ui/` primitives; no `Date.now()`/`new Date()` without args in parsers (pass `today`).
- Gate: `pnpm lint` (root) **and** `pnpm --filter ./functions run lint` (the recursive `lint:all` only covers functions), `pnpm test`, `pnpm run build`, and the Playwright `pnpm test:e2e` suite must be green. Run a 3-lens adversarial review (correctness / conventions / cost-behavior) before merge — the NL rework is product-visible.
- **Do not** re-introduce held-item seeds into the default `MockHouseholdContext` (they auto-open the review drawer and break the e2e suite — see PR #1062). If Test-Mode coverage of unclassified cards is wanted, gate it behind a dedicated `TEST_SEED_VARIANT`.
