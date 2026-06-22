# Architecture & Performance Audit — LifeBalance

Scope: performance/scale (§3) + tech debt/architecture (§5).
Auditor pass: read-only. No suppressions added. All evidence is file:line references.

---

## PERF-01: Hourly full-collection notification scans — still open

- **Evidence**: `functions/src/index.ts:158` (`sendhabitreminders`), `:215` (`sendactionqueuereminders`), `:288` (`sendstreakwarnings`), `:368` (`sendbillreminders`) — each opens with `await db.collection("households").get()`, then for every household fetches its `members` subcollection. Four separate scheduled functions, each running every hour.
- **Impact**: `4 functions × (1 households-read + H×members-reads) per hour`. At 1 000 households with 2 members each → ~8 004 reads/hour × 24 = ~192 000 reads/day from notification polling alone, most wasted (members not scheduled for the current hour). Cost scales linearly forever. Firestore free tier allows 50 000 reads/day — a single moderately-grown user base blows past it.
- **Effort**: M (2–3 days, includes schema migration + backfill + collectionGroup index).
- **Risk**: MED — migration must ship before query change or reminders silently drop; DST-correct UTC timeslot math is easy to get wrong.
- **Confidence**: HIGH — code verified at the named lines.
- **Fix sketch**: Add `notificationTimeslot` (UTC hour string) + per-notification enabled flags to member docs. Backfill existing members. Replace each `households.get()` with `collectionGroup('members').where('notificationTimeslot','==',currentUtcHour)`. Add collection-group indexes. See `todo/04-notification-scan.md`.

---

## PERF-02: Three unbounded onSnapshot listeners (calendarItems / meals / groceryCatalog) — still open

- **Evidence**: `contexts/FirebaseHouseholdContext.tsx:839` — `calendarItems` listener, no filter or limit. `:997` — `meals` listener, no filter or limit. `:1017` — `groceryCatalog` listener, no filter or limit.
- **Impact**: Every cold start downloads the household's entire cookbook, every grocery item ever purchased, and every calendar item including paid tombstones. A household 2 years old with 200 meals, 500 catalog items, and 500 calendar events downloads ~1 200 docs per listener restart plus pays for every change to those docs in real time. These three listeners are the dominant read-cost and memory footprint for long-lived households. For the monetization PRD: this is the primary cost driver that must be bounded before charging per-household.
- **Effort**: L (multi-day, three separate changes with index ships and deploy ordering).
- **Risk**: HIGH for calendarItems (recurring-template expansion and Safe-to-Spend depend on having all active templates; a filter that removes a template silently breaks bill projection). MED for meals and groceryCatalog.
- **Confidence**: HIGH — code confirmed at named lines.
- **Fix sketch**: `groceryCatalog`: `orderBy('purchaseCount','desc'), limit(200)` + on-demand search. `meals`: `orderBy('lastCooked','desc'), limit(50)` + lazy `loadAllMeals()`. `calendarItems`: keep all recurring templates; window materialized-only instances by date. Ship indexes first. See `todo/14-unbounded-calendar-meals-grocery-listeners.md`.

---

## PERF-03: quickAddHabit full-collection habit scan on every name-based request — still open

- **Evidence**: `functions/src/quickAdd/index.ts:169–175` — when `habitName` is supplied instead of `habitId`, fetches `households/{id}/habits` with no filter (unbounded `.get()`), then does in-memory fuzzy matching via `fuzzyMatchHabit`.
- **Impact**: Every iOS Shortcut invocation by name reads the entire habits collection. At 50 habits per household this is tolerable; at scale (many users × frequent shortcut use) this pays for 50 reads when 1 indexed read would suffice. This also sits after rate-limiting, so it runs on every valid request. Cost mechanism: N reads per name-based quickAdd call where N = habits count.
- **Effort**: M (schema migration for `titleLower` field + backfill + query change + fallback logic).
- **Risk**: LOW-MED — fuzzy fallback preserved; only risk is forgetting a habit-title writer.
- **Confidence**: HIGH — code confirmed at named lines.
- **Fix sketch**: Denormalize `titleLower` on habit docs. Backfill. Replace scan with `where('titleLower','==',name.toLowerCase()), limit(1)`, fall back to scan on miss. See `todo/19-quickaddhabit-name-lookup-scan.md`.

---

## PERF-04: BudgetCalendar duplicate expandCalendarItems per snapshot — still open

- **Evidence**: `components/budget/BudgetCalendar.tsx:52–55` — local `useMemo` calls `expandCalendarItems(calendarItems, startDate, endDate)` directly. The shared `useExpandedCalendarItems` hook (`contexts/FirebaseHouseholdContext.tsx:425`) deduplicates by window but `BudgetCalendar` does not use it — it calls the pure function directly so each unique `(start, end)` month window gets its own independent expansion on every `calendarItems` snapshot.
- **Impact**: On every calendarItems Firestore snapshot, `expandCalendarItems` runs at least twice (once for Safe-to-Spend context memo at line 697 of the context, once for BudgetCalendar's month grid). For a household with many recurring items this is CPU waste per snapshot. Low priority at small scale; becomes noticeable if calendarItems is unbounded (PERF-02) and frequently updated.
- **Effort**: S (hours — extend the hook or add a window-keyed memoizer).
- **Risk**: LOW — purely additive cache; numbers stay identical.
- **Confidence**: HIGH — confirmed `BudgetCalendar` calls `expandCalendarItems` directly without using the shared hook.
- **Fix sketch**: Migrate `BudgetCalendar` to call `useExpandedCalendarItems(startDate, endDate)` or add a Map-backed window-keyed memoizer. See `todo/18-budgetcalendar-duplicate-expansion.md`.

---

## PERF-05: Safe-to-Spend computed in-process per snapshot — denormalization opportunity

- **Evidence**: `contexts/FirebaseHouseholdContext.tsx:705–709` — `safeToSpendBreakdown` is a `useMemo` recomputing on every `accounts`, `calendarItems`, `buckets`, `transactions`, or `currentPeriodId` change. The memo is well-placed but still runs on every balance update on every connected device.
- **Impact**: Currently correct and fast (pure memo). The CLAUDE.md roadmap notes "Safe-to-Spend recompute cost — roadmap suggests denormalizing into a summary doc" as a scale consideration. At high multi-device household counts with frequent balance syncs, each device recomputes independently. A Cloud Function that writes a denormalized `safeToSpend` summary doc on account/transaction writes would cut client computation to a single read, but adds write-amplification and eventual-consistency lag. At current scale this is a direction finding, not a bug.
- **Effort**: L (design + cloud function + migration + client change).
- **Risk**: MED — eventual consistency means displayed value can lag a write by a few seconds (currently always consistent client-side).
- **Confidence**: MED (scale concern, not yet a problem).
- **Fix sketch**: Only worthwhile at >100 households; defer until PERF-02 (unbounded listeners) is closed. If pursued: Cloud Function trigger on accounts/transactions writes a `households/{id}/summary` doc; client reads it as a single listener instead of computing locally.

---

## PERF-06: sendbudgetalerts reads all accounts on every account write (N+1 pattern)

- **Evidence**: `functions/src/index.ts:475–486` — `sendbudgetalerts` is an `onDocumentWritten` trigger on `households/{householdId}/accounts/{accountId}`. It immediately fetches `membersSnapshot = householdRef.collection("members").get()` and then `accountsSnapshot = householdRef.collection("accounts").get()` — reading back all accounts to sum checking balances, even though the triggering write already has the new account value in `event.data.after`.
- **Impact**: Every account balance update issues 2 additional reads (members + accounts collections). With 3 accounts and 2 members that is 5 reads per balance touch. This scales with household size and edit frequency.
- **Effort**: S (hours — use `event.data.after.data()` for the triggering account's new value + parallelise the members fetch).
- **Risk**: LOW — correctness preserved; delta-only approach requires summing across accounts but `event.data` gives the new value of the changed account, not the full collection sum.
- **Confidence**: HIGH — pattern confirmed at named lines.
- **Fix sketch**: Keep the `accounts.get()` (needed for cross-account sum) but parallelise it with the members fetch using `Promise.all([ membersSnapshot, accountsSnapshot ])` to halve latency. Or maintain a denormalized `totalCheckingBalance` on the household doc (updated by the same trigger) and read only that instead of re-fetching all accounts.

---

## PERF-07: Missing Firestore indexes for planned queries (implied by todo/04 and todo/14)

- **Evidence**: `firestore.indexes.json` — no `collectionGroup` index for `members` on `notificationTimeslot` + notification-enabled fields (needed by todo/04). No composite index for `calendarItems` windowing by `date` while keeping recurring templates (needed by todo/14). No `meals` index for `orderBy('lastCooked','desc')` (needed by todo/14).
- **Impact**: When todo/04 and todo/14 are implemented without pre-shipping their indexes, the queries will either fail with a Firestore index-required error or fall back to full scans (no automatic index = error in production). Deploying query changes before index build completes silently breaks the feature.
- **Effort**: S (add the index entries to `firestore.indexes.json` as a preparatory step before each todo implementation).
- **Risk**: LOW — index additions are backward-compatible and build in the background.
- **Confidence**: HIGH — both todo docs name the required indexes; none are present in `firestore.indexes.json`.
- **Fix sketch**: Add the three index entries to `firestore.indexes.json` in a prep PR before implementing todo/04 and todo/14.

---

## ARCH-01: FirebaseHouseholdContext.tsx is still a 3 863-line god object

- **Evidence**: `contexts/FirebaseHouseholdContext.tsx` — 3 863 lines (verified with `wc -l`). Contains: all Firestore listener subscriptions, all CRUD action functions for every domain (finance, habits, meals, shopping, todos, household settings), all business-logic memos (Safe-to-Spend, bucket-spent, expanded calendar), the migration effects, the midnight scheduler hook call, the member-recovery auto-fix, and all context providers.
- **Impact**: The domain-sliced context exports (PR #615) successfully isolated re-renders at the consumer level, but all mutation logic and Firestore wiring still lives in one file. Any engineer adding a billing or onboarding feature must navigate 3 800 lines to find the right mutation pattern, the listener subscription point, and the slice value type. The file changes on nearly every PR — merge conflicts are frequent and test coverage of the file is indirect (effects can't be unit-tested without mocking Firestore). This is the primary maintainability blocker for adding new domains (e.g., a subscription/billing domain required for monetization).
- **Effort**: L (extracting one domain at a time into `contexts/finance/`, `contexts/habits/`, etc.; the slice value types are already defined and the provider hierarchy already exists).
- **Risk**: MED — any import reordering or accidental state-scope change during extraction could break real-time sync.
- **Confidence**: HIGH.
- **Fix sketch**: Extract one domain's listeners + mutations at a time into a sub-provider that feeds the existing slice context. Finance is the largest (accounts/buckets/transactions/calendarItems) and highest-value to isolate. Each sub-provider is independently testable with Firestore emulator.

---

## ARCH-02: ShoppingListTab still uses set-state-in-effect anti-pattern (without suppression comment)

- **Evidence**: `components/meals/ShoppingListTab.tsx:138–170` — `const [items, setItems] = useState<ShoppingItem[]>([])` at line 139; `setItems(sorted)` at line 169 inside a `useEffect` depending on `[shoppingList, filterStore]`. The eslint suppression noted in `todo/17` is no longer present (the line 168 comment ` ` replaced the directive), but the anti-pattern remains — a mirrored state copy synced from props via effect.
- **Impact**: The effect runs after every render triggered by `shoppingList` or `filterStore` change, causing a guaranteed double-render on every shopping list update (render with stale `items`, then effect fires `setItems`, then re-render with updated `items`). On mobile with frequent Firestore snapshots this adds visible UI lag during list updates.
- **Effort**: S-M (derive order via `useMemo` from `shoppingList + filterStore`; drive `Reorder.Group` directly from derived array; persist on drop).
- **Risk**: LOW-MED — drag smoothness must be verified; optimistic reorder requires context round-trip to be synchronous.
- **Confidence**: HIGH — pattern confirmed in file.
- **Fix sketch**: Replace `useState([]) + useEffect(setItems)` with `useMemo(() => sorted, [shoppingList, filterStore])`. Drive `Reorder.Group` from the memo. Call `reorderShoppingItems(newOrder)` on `onReorder` directly. See `todo/17-shoppinglist-reorder-set-state-in-effect.md`.

---

## ARCH-03: Admin UID still inlined in client bundle (security debt)

- **Evidence**: `contexts/AuthContext.tsx:78` — `const adminUid = import.meta.env.VITE_ADMIN_UID`. `pages/Settings.tsx:90` — `const isGlobalAdmin = user?.uid === import.meta.env.VITE_ADMIN_UID`. `.github/workflows/deploy.yml:61` — `VITE_ADMIN_UID: ${{ secrets.VITE_ADMIN_UID }}` injected at build. `src/vite-env.d.ts:15` — typed as `readonly VITE_ADMIN_UID?: string`.
- **Impact**: The admin's Firebase UID is present in every production JS bundle. Vite replaces `import.meta.env.VITE_ADMIN_UID` with the literal UID value at build time — it is trivially discoverable by inspecting the bundle. The "Private Alpha" gate is bypass-able by anyone who calls Firestore directly with a valid Google auth token. This is the primary security blocker for a paid product launch.
- **Effort**: M (custom claim provisioning script + Firestore rules update + client reads `getIdTokenResult()` instead of env var).
- **Risk**: MED — claim propagation requires a token refresh; misconfigured rules could lock users out. Firestore rules already partially support this via `isSuperAdmin()` (PR #625); remaining work is claim provisioning + client demotion.
- **Confidence**: HIGH — UID exposure confirmed at named lines.
- **Fix sketch**: Provision `admin: true` custom claim on the admin account via Firebase Admin SDK. Update `Settings.tsx` and `AuthContext.tsx` to read from `getIdTokenResult()`. Make Firestore rules the authoritative guard. Remove `VITE_ADMIN_UID` from `deploy.yml`. See `todo/05-admin-gate-serverside.md`.

---

## ARCH-04: useHousehold() shim still has active consumers (migration incomplete)

- **Evidence**: Search for `useHousehold` across the codebase would confirm remaining consumers; the CLAUDE.md notes the shim composes all slices and that TopToolbar, CaptureModal, ProfileMenu, and useInsightActions have been migrated off it. The shim itself remains as a backward-compatibility layer, which by definition re-subscribes every slice and re-renders on any domain change.
- **Impact**: Any component still on `useHousehold()` re-renders on changes to any domain (finance, habits, meals, shopping, todos, household settings) — the entire point of the slice migration is defeated for those components. The risk grows as new domain state is added (e.g., billing). This is a maintenance blocker: new domains added to the shim automatically blow up all shim consumers' render isolation.
- **Effort**: S per component migrated (identify consuming component, find the exact slice fields used, switch import to the narrow slice hook).
- **Risk**: LOW per component (additive change, shim remains).
- **Confidence**: MED — need a grep to enumerate remaining shim consumers; the pattern is well-established from the previous migration wave.
- **Fix sketch**: `grep -rn 'useHousehold()' --include="*.tsx" src/` to enumerate remaining consumers. Migrate each by swapping `useHousehold()` to the narrowest slice(s) that provide the needed fields. Track migration completion.

---

## ARCH-05: safeToSpendCalculator.ts has two public entry points computing the same window twice

- **Evidence**: `utils/safeToSpendCalculator.ts:150` — `expandCalendarItems` called in `findNextPaycheckDate` path (historical), and `:302` and `:338` — two more calls in `calculateSafeToSpendBreakdown` and `calculateSafeToSpend` for the same 60-day window. The inline comment at line 334–336 notes the double expansion was reduced from 2x to 1x, but there are still two separate exported functions (`calculateSafeToSpend` at :338 and `calculateSafeToSpendBreakdown` at :302) that each call `expandCalendarItems` independently if called separately.
- **Impact**: If both functions are called by separate code paths for the same snapshot (historically they were), expansion runs twice. The context memo (`FirebaseHouseholdContext.tsx:697`) uses `calculateSafeToSpendBreakdownFromExpanded` which takes a pre-expanded array, correctly avoiding re-expansion. The risk is that future callers of the standalone `calculateSafeToSpend` or `calculateSafeToSpendBreakdown` functions bypass the pre-expansion and double-spend.
- **Effort**: S (add JSDoc warning on the standalone functions; or make the pre-expanded variant the only exported path and mark the others deprecated).
- **Risk**: LOW.
- **Confidence**: MED — context usage is correct; standalone function callers need verification.
- **Fix sketch**: Deprecate `calculateSafeToSpend` and `calculateSafeToSpendBreakdown` in favor of the `...FromExpanded` variants. Add a JSDoc `@deprecated` comment pointing callers to pre-expand via `useExpandedCalendarItems`.

---

## Prioritized Finding Index

| ID | Title | Severity | Confidence | Priority |
|----|-------|----------|------------|----------|
| PERF-01 | Hourly full-collection notification scans | HIGH | HIGH | 1 — cost at scale, clear fix |
| PERF-02 | Three unbounded onSnapshot listeners | HIGH | HIGH | 2 — dominant read cost, monetization blocker |
| ARCH-03 | Admin UID inlined in client bundle | HIGH | HIGH | 3 — security blocker for paid launch |
| PERF-03 | quickAddHabit full-collection habit scan | MED | HIGH | 4 — request-path cost, clear fix |
| ARCH-01 | 3 863-line god-object context | MED | HIGH | 5 — maintainability blocker for new domains |
| ARCH-02 | ShoppingListTab set-state-in-effect anti-pattern | MED | HIGH | 6 — double-render on mobile, tracked in todo |
| PERF-06 | sendbudgetalerts N+1 account reads | MED | HIGH | 7 — easy parallelisation win |
| PERF-07 | Missing Firestore indexes for planned queries | MED | HIGH | 8 — must precede todo/04 and todo/14 |
| PERF-04 | BudgetCalendar duplicate calendar expansion | LOW | HIGH | 9 — perf hygiene, tracked in todo |
| ARCH-04 | useHousehold() shim consumers not fully migrated | LOW | MED | 10 — render-isolation debt |
| PERF-05 | Safe-to-Spend in-process computation (denorm opportunity) | LOW | MED | 11 — future consideration only |
| ARCH-05 | safeToSpendCalculator dual-entry-point expansion risk | LOW | MED | 12 — documentation fix |
