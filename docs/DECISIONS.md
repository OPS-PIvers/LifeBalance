# Decisions & standing traps

**Not a task archive.** An entry earns a place here only if someone could plausibly undo it by
accident — a deliberate behavior that reads like a bug, a question already argued to a conclusion, or
a trap that outlived the work that found it. Finished tasks are deleted from `TODO.md` with no record
here; their PR is the record.

This file is **not** auto-loaded into agent context. Link to it from a code comment or a test name
when the trap is code-adjacent, so it is read at the moment it would be broken.

---

## Member-doc writes: `affectedKeys()`, never `changedKeys()` — and test as a non-admin

**Decided 2026-07-26 (#1106).**

`firestore.rules`' member self-update gate is an allowlist. **Every new `HouseholdMember` field must
be added to it**, or writes fail — and two properties conspire to hide that:

- **`changedKeys()` excludes newly-*added* keys** (they land in `addedKeys()`). A member's *first*
  write to a new field passes vacuously; every write after it is denied. This shipped to production
  twice — once as broken dashboard widgets, once as a live **privilege-escalation path** where any
  member could add `points` / `allowanceCents` / `isManaged` to their own doc. Case 1 and the
  managed-kid Case 3 now use `affectedKeys()` (added ∪ changed ∪ removed).
- **`isAdminOf()` is a blanket bypass**, so the whole class is invisible from an admin account.

**When adding a member field:** add it to the allowlist, and test as a **non-admin** with an
**add-then-change** pair — a change-only test passes against the broken rule.

The same applies to allowlisted *subcollection* docs: `/todos`' `hasOnly` sees the **merged** doc,
which is how `needsReview` silently denied every approve.

---

## Bill ↔ transaction matching: the amount tolerance is deliberate

**Decided 2026-07-27 (2H).** Two tests pin this. Do not "fix" it by widening the window.

Only the **rule** tier bypasses the ±10% / ±$25 amount guard. The **alias** tier is gated by it, so on
a variable-amount utility a learned alias still will not match — `Cpenergy Mngco` at $37.91 against a
$142.00 scheduled Centerpoint bill stays two rows even after the alias is learned.

That is the correct trade. A false positive here **silently marks the wrong bill paid**, which is
worse than a visible duplicate. The affordance gap it leaves was closed by giving the user an explicit
merge action (`settleBillWithTransaction`), not by loosening matching.

---

## Settled bills: undo is one-directional by design

**Decided 2026-07-27 (2H).**

Once a transaction settles a bill, `utils/settledBillGuard.ts` makes `deleteTransaction`,
`mergeTransactions`, `splitTransaction`, `updateTransaction` (money fields) and
`reverseTransactionApproval` all **refuse**, pointing the user at the calendar. Deleting the paid
calendar doc releases the guard (the guard keys on the bill still being paid), so a row can never be
trapped.

The guard refuses by **toasting and returning normally**, deliberately — throwing would bury the
specific refusal under a generic "Failed to update" toast. The cost is a real open bug: batch
operations `Promise.allSettled` over the selection and see a *fulfilled* promise for a refused row.
That is tracked in `TODO.md` §2C, not a reason to make the guard throw.

Two more deliberate omissions on that path: **no habit firing**, **no price-change nudge**, and **no
`MerchantRule` upsert** (the alias write is kept instead).

---

## `points.total` drift: do NOT repair

**Decided 2026-07-31. PR #1168 closed with the full reasoning.**

A pre-#1163 bug paid the pool both awards but wrote only the triggering member's, for weekly threshold
habits completed by two members on different days. `points.total` is a lifetime counter that
`computeMemberPointsReset` omits and `computeHouseholdPointsSync` only ever **raises**, so banked
drift is permanent and will not self-heal.

Not repairing, because **nothing reads an adult's `points.total`** — every adult surface (standings,
podium, crown, scoreboard, recap) reads `points.weekly` / `points.daily`, and the only gating reads
are kid-only with Kid Mode dormant. Magnitude is tens of points over a ~1.5-day window; the bug is
frozen.

A hardened repair tool is **archived, not on a branch** — recover with
`git bundle unbundle ../LifeBalance-branches-2026-08-01.bundle` (`fix/points-drift-repair` = hardened
tool at `510d68c7`; `wip/points-drift-repair` = unverified draft). It writes **upward only**; its Scan
path is read-only, so a number can be obtained at zero risk if ever wanted.

There is **no live successor.** `PointsBreakdownModal`'s threshold past-date edit carried the same
inflation but was unreachable since PR #819 and has since been deleted as dead code (#1172).

---

## Household-undo trade-offs accepted in review (#1166 / #1169)

**Decided 2026-07-30.** Recorded so they are not re-filed as bugs.

- **The tie-break on a date carrying BOTH an automation doc and a manual `creditsHousehold` doc was
  DECLINED.** Newest-`createdAt` sort may delete the automation doc, destroying its
  `sourceTransactionId` audit record — after which `firedHabitIds` (`arrayUnion`, cleared only by
  un-verifying) prevents that habit ever re-firing from the transaction. Preferring `creditsHousehold`
  docs was rejected because it is **not points-neutral**: the two doc classes reverse the pool by
  different arithmetic (`periodPointsMove` decomposition vs. stored `pointsEarned` via `legacyDelta`),
  so it changes the pool delta in an unprobed case.
- **A narrow accepted orphan:** a grandfathered doc on a date that has *since* gained attribution is no
  longer swept and falls back to the attribution-only primitive. Deliberate — sweeping it would destroy
  real attribution. Resolves once the `deleteHabitSubmission` creditee bug (`TODO.md` §3B) is fixed.
- **Stale-deselect of a below-target incremental prior period reverses nothing** by design
  (`processStaleDownToggle` contract). Pool and member stay mutually consistent; only orphan
  attribution residue remains. Revisit only if "undo the previous period" should mean more than
  completion-date reversal for incremental habits.

---

## Recap chart stays positive-only; every fix is on the labelling side

**Decided 2026-07-30.** `buildRecapChart` filters segments to `> 0`, so a week whose household share
is net negative draws no Household bar. That is the product decision — the chart does not represent
negative days.

The labelling carries the honesty instead, and each branch's stated reason is scoped to what it can
actually prove: the household card's line gates on whether the chart **draws** a Household bar (segment
existence and column height are independent figures), the wording keys off the figure's **sign** so a
loss is never phrased as something "earned", the loss branch names the omitted **segment**, and the
positive/no-bar branch names only the days the share was **gained** on — a day carrying a negative
contribution is clamped out however tall its column is.

`householdSharePoints` is rounded to 2dp defensively: every writer-emitted value is integer-floored, so
the rounding only insures against `weeklyRecapConverter`'s untyped cast letting a float-epsilon sum
render as `5.55e-17` and slip past the card's `!== 0` gate.

---

## `ShoppingItem.quantity` is normalized at the converter — and `functions/` is not covered

**Decided 2026-07-26 (#1107).**

Both `string` and legacy `number` shapes exist in Firestore. A numeric value crashed four separate
consumers (`parseQuantity`, `printWeekHtml`'s `escapeHtml`, `geminiService`'s `sanitizeForPrompt`, the
voice-capture path). Root-caused at the boundary rather than patched per call site:
`shoppingItemConverter.fromFirestore` normalizes to a string on read.

**`functions/` intentionally keeps its own `string | number` handling** — the Admin SDK bypasses client
Firestore converters entirely, so the normalization does not apply there. Do not "simplify" it away.

---

## Re-verified as non-issues — do not re-file

- **SEC-04 quickAdd rate-limiter "fails open"** — stale finding. `checkRateLimit()` already fails
  **closed** on error, with a test covering it.
- **`safeToSpendCalculator.ts` `getTime()`-equality branch is dead code** — stale. It is reachable and
  load-bearing (includes a bill dated exactly on the next paycheck; covered by the "bills on boundary
  dates" test).
- **`ShoppingListTab` mirrored-state-in-effect should be a derived `useMemo`** — won't-fix. The
  mirrored state is load-bearing for `Reorder.Group` drag gestures (local mutation gated by
  `isDraggingRef` before committing via `reorderShoppingItems`); deriving it breaks mid-drag reordering.
- **Sticky save footers** — `TransactionMasterList`'s mobile filter sheet (filters apply live, no commit
  action) and `HabitSubmissionLogModal`'s inline add form (already at the top of its tab) are
  deliberately excluded from the drawer-footer convention.
- **`components/meals/MealPlanTab.test.tsx`'s "extends the day strip window…" test** is a pre-existing,
  load-sensitive flake. Not a regression from any recent work; don't chase it as one.
