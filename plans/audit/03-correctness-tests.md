# Audit 03 — Correctness & Test Coverage

**Date:** 2026-06-21  
**Scope:** §1 Correctness (money paths, habit scoring, async hazards, non-atomic writes) + §4 Test Coverage (critical path mapping, gap analysis, quality assessment)  
**Finding format:** per `audit-playbook.md`

---

## Correctness Findings

---

### [CORRECTNESS-01] Server `processToggleHabit` omits sign factor for negative habits — wrong-sign points via iOS Shortcut

- **Evidence:** `functions/src/quickAdd/habitProcessor.ts:128-146` — incremental branch awards `Math.floor(basePoints * multiplier)` (always positive) on toggle-up; threshold branch awards the same on first completion. Neither branch multiplies by `sign = habit.type === 'positive' ? 1 : -1`. Client at `utils/habitLogic.ts:335, 365` applies `sign` correctly.
- **Impact:** Every negative habit triggered via iOS Shortcut quickAdd awards positive points instead of deducting them (or deducts on toggle-down instead of restoring). In production, users who enter negative habits via Shortcut accumulate inflated point totals instead of being penalized — corrupting the gamification metric permanently.
- **Effort:** S (hours) — add `const sign = habit.type === 'positive' ? 1 : -1;` and multiply `pointsChange` by `sign` in the two branches, matching client logic exactly.
- **Risk:** LOW — the fix is surgical and directly mirrors the already-tested client code. The server function unit tests in `habitProcessor.test.ts` need a negative-habit test case added.
- **Confidence:** HIGH — read both files; the divergence is unambiguous.
- **Fix sketch:** At `habitProcessor.ts:108` derive `const sign = habit.type === 'positive' ? 1 : -1;`. Multiply `pointsChange` assignments at lines 129, 131, 143, 145 by `sign`. Add a `habitProcessor.test.ts` case for a `type: 'negative'` habit toggled via quickAdd.

---

### [CORRECTNESS-02] `addTransaction` non-atomic two-step write: transaction created before account balance updated

- **Evidence:** `contexts/FirebaseHouseholdContext.tsx:2440` — `await addDoc(…transactions…)`, then `contexts/FirebaseHouseholdContext.tsx:2446` — `await updateDoc(…accounts…)` as two sequential awaits with no `writeBatch`. Compare: `updateTransaction` (line 2588) and `deleteTransaction` (line 2630) already use a single batch for exactly this reason.
- **Impact:** On mobile with flaky connectivity or if the browser tab closes between the two writes, the transaction record persists in Firestore but the checking account balance is never debited. Safe-to-Spend is permanently overstated by the transaction amount; the discrepancy cannot self-correct because there is no compensating mechanism.
- **Effort:** S (hours) — wrap both writes in `writeBatch`, mirroring the pattern already used in `updateTransaction`.
- **Risk:** LOW — replacing two sequential writes with a batch preserves all existing behavior; no schema changes.
- **Confidence:** HIGH — code read directly; the pattern diverges from sibling functions that already batch these two ops.
- **Fix sketch:** Create `const batch = writeBatch(db)`, convert `addDoc` → `batch.set(newRef, docData)`, convert `updateDoc` → `batch.update(accountRef, …)`, `await batch.commit()`.

---

### [CORRECTNESS-03] `handleExpense` (voice command path) never debits the checking account balance

- **Evidence:** `contexts/FirebaseHouseholdContext.tsx:1266-1285` — `handleExpense` calls a single `addDoc` for the transaction. No account `updateDoc`/batch follows. The regular `addTransaction` path at lines 2440-2450 always attempts the account debit (even if that debit is itself non-atomic, per CORRECTNESS-02).
- **Impact:** Every expense entered via iOS voice command records in the transaction ledger and affects `bucketSpentMap` correctly, but the checking account balance shown on the Dashboard is never reduced. Safe-to-Spend is permanently overstated by the cumulative sum of all voice-entered expenses. For active voice-command users this is a structural blind spot in the app's primary financial metric.
- **Effort:** S (hours) — add an account balance `update` after the `addDoc` (or wrap in a batch once CORRECTNESS-02 is fixed), following the same pattern as `addTransaction`.
- **Risk:** LOW — additive change; no existing behavior is removed.
- **Confidence:** HIGH — `handleExpense` read end-to-end; confirmed no account write exists.
- **Fix sketch:** After the `addDoc` in `handleExpense`, look up the checking account (same as `addTransaction` lines 2444-2450) and call `updateDoc` (or include in a batch) to decrement the balance by `data.amount`.

---

### [CORRECTNESS-04] `payCalendarItem` income path: period-reset batch and payment batch are two sequential atomic ops — partial-commit leaves pay period advanced without income credited

- **Evidence:** `contexts/FirebaseHouseholdContext.tsx:2184-2257` — for `item.type === 'income'`, line 2185 `await handlePaycheckApproval(specificDate)` commits a writeBatch that advances `lastPaycheckDate` and resets all buckets. Then lines 2212-2257 commit a second independent writeBatch that marks the item paid, credits the account, and creates the income transaction. The comment at line 2183 acknowledges this: "runs as its own prior atomic op before the writeBatch below".
- **Impact:** If the app is killed, goes offline, or Firestore rejects the second batch after the first commits: the pay period advances (buckets reset, `lastPaycheckDate` = new period), but the paycheck income calendar item remains unpaid, no income transaction is recorded, and the account balance is not credited. The user's Safe-to-Spend for the entire new period is permanently understated; the paycheck shows as unpaid. Manual recovery is required.
- **Effort:** L (multi-day) — merging into a single batch requires fitting all bucket resets + the payment writes within Firestore's 500-document batch limit. A runTransaction may be a safer path. The fix must be carefully tested.
- **Risk:** HIGH — this is a core money path touched on every paycheck; the fix is architecturally significant.
- **Confidence:** HIGH — code read directly; the two-batch structure and failure mode are explicit.
- **Fix sketch:** Evaluate whether number of buckets + payment ops reliably stays under 500 (almost certainly yes for household scale). If so, merge `resetBucketsForNewPeriod` and the payment writes into a single batch. Alternatively, use a Firestore `runTransaction` to make the combined op atomic with a server-side read.

---

### [CORRECTNESS-05] `deferCalendarItem` recurring branch: deferred item and tombstone created as two separate `addDoc` calls

- **Evidence:** `contexts/FirebaseHouseholdContext.tsx:2317` — `await addDoc(…calendarItems, deferredItem)`, then `contexts/FirebaseHouseholdContext.tsx:2329` — `await addDoc(…calendarItems, tombstone)`. No batch. The non-recurring branch at lines 2303-2313 correctly uses a single `updateDoc`.
- **Impact:** If the second write fails (offline, crash), the deferred copy is created but the original recurring instance is not tombstoned. The bill appears twice: once on its original date (still visible) and once on the deferred date. Paying the original instance then creates a second paid record without removing the deferred copy.
- **Effort:** S (hours) — wrap both `addDoc` calls in a `writeBatch.set`, mirroring the `payCalendarItem` recurring-instance pattern.
- **Risk:** LOW — additive fix; the non-recurring branch is unaffected.
- **Confidence:** HIGH — code read directly.
- **Fix sketch:** Create `const batch = writeBatch(db)`, replace the two `addDoc` calls with `batch.set(newRef1, deferredItem)` and `batch.set(newRef2, tombstone)`, `await batch.commit()`.

---

### [CORRECTNESS-06] `markChallengeComplete` with yearly-goal link: challenge update then yearly-goal update are two sequential writes

- **Evidence:** `contexts/FirebaseHouseholdContext.tsx:2802-2810` — `await updateDoc(challengeRef, {status: 'success', …})`, then if `challenge.yearlyGoalId` is set calls `await updateYearlyGoalProgress(…)` which issues a second `await updateDoc`. No batch wraps both.
- **Impact:** If the second write fails, the challenge is permanently marked successful but the yearly goal progress for that month is never recorded. The user's yearly goal shows no credit for a month they actually completed.
- **Effort:** S (hours) — inline `updateYearlyGoalProgress`'s Firestore write into a batch alongside the challenge status update, or restructure `updateYearlyGoalProgress` to accept an optional batch.
- **Risk:** LOW — only affects challenges linked to a yearly goal; the common case (no linked goal) is a single write and is unaffected.
- **Confidence:** HIGH — code read directly.
- **Fix sketch:** When `challenge.yearlyGoalId` is set, compute the `updatedMonths` array inline (as `updateYearlyGoalProgress` already does), then issue a single `writeBatch` containing both the challenge status update and the yearly goal `successfulMonths` update.

---

### [CORRECTNESS-07] `toggleShoppingItemPurchased`: shopping-item mark and grocery-catalog update are non-atomic

- **Evidence:** `contexts/FirebaseHouseholdContext.tsx:3223-3257` — `await updateDoc(shoppingItemRef, {isPurchased: true})` then `await updateDoc/addDoc` for the catalog entry as separate awaits. No batch.
- **Impact:** If the second write fails, the item is marked purchased but the grocery catalog purchase-count (used for shopping suggestions) is not incremented. Over time, purchase history silently diverges from actual purchasing, degrading AI shopping suggestions.
- **Effort:** S (hours) — wrap in a `writeBatch`.
- **Risk:** LOW — purely additive change to wrap existing writes.
- **Confidence:** HIGH — code read directly.
- **Fix sketch:** Create `const batch = writeBatch(db)`, convert the shopping-item `updateDoc` and the catalog `updateDoc`/`addDoc` to `batch.update`/`batch.set`, `await batch.commit()`.

---

### [CORRECTNESS-08] `calculatePointsForDate` skips historical completions when `habit.count === 0`

- **Evidence:** `utils/habitLogic.ts:493` — `if (habit.count === 0) continue;` guard fires for any habit whose current count is 0, regardless of whether `targetDate` is today or a past date.
- **Impact:** After a manual reset (which sets `count = 0`), the corrective points sync triggered on login calls `calculatePointsForDate(habits, yesterday)`. Any habit with `count === 0` (because it was reset) is skipped even if yesterday is in its `completedDates`. The previous day's points are silently dropped from the recalculated daily/weekly total, causing permanent drift downward that accumulates across resets.
- **Effort:** S (hours) — guard should only skip when `targetDate` is "today" (rely on `completedDates.includes(targetDate)` alone for historical dates; the `count` check is only meaningful for today).
- **Risk:** MED — changing this guard changes the recalc behavior; must be paired with tests for the historical-date case.
- **Confidence:** HIGH — logic read directly; the interaction with `getHabitResetUpdate` (which zeros `count`) makes the failure mode concrete.
- **Fix sketch:** Replace `if (habit.count === 0) continue;` with `const today = getLocalDateString(); if (habit.count === 0 && targetDate === today) continue;`. Add a test case: habit completed yesterday + reset today → `calculatePointsForDate(habits, yesterday)` must include those points.

---

### [CORRECTNESS-09] Server `resetStaleHabit` does not strip today from `completedDates` — stale completion bleeds into the next toggle's streak

- **Evidence:** `functions/src/quickAdd/habitProcessor.ts:177-183` — returns `{ count: 0, lastUpdated: … }` only; `completedDates` and `streakDays` are unchanged. The comment says "they'll be recalculated on next toggle". Client equivalent `getHabitResetUpdate` at `utils/habitLogic.ts:463-475` explicitly filters today's date from `completedDates` before returning.
- **Impact:** If a habit was completed today via a prior quickAdd call, then a stale-reset fires in a subsequent call within the same server-UTC day, the stale completion date remains in `completedDates`. The immediately-following `processToggleHabit` call sees today already in `completedDates` and computes a prospective streak that includes a now-invalid entry, potentially granting a 1-unit-longer streak (and higher multiplier) than the user earned.
- **Effort:** S (hours) — add `completedDates` and `streakDays` fields to `resetStaleHabit` output, mirroring `getHabitResetUpdate`.
- **Risk:** LOW — only changes server-side stale-reset behavior; the client path already handles this correctly.
- **Confidence:** HIGH — both files read directly; the divergence is unambiguous.
- **Fix sketch:** Pass `today` into `resetStaleHabit`, filter it from `completedDates`, recompute `streakDays` via `streakForPeriod`, and return all three fields — matching `getHabitResetUpdate`.

---

### [CORRECTNESS-10] `processToggleHabit` threshold branch: `targetCount === 0` makes `wasCompletedBefore` always true — no points ever awarded, but reset subtracts them

- **Evidence:** `utils/habitLogic.ts:371-373` — `const target = habit.targetCount; wasCompletedBefore = habit.count >= target;`. With `targetCount = 0` and initial `count = 0`: `wasCompletedBefore = (0 >= 0) = true` from the start, so `isCompletedNow && !wasCompletedBefore` is never true → no points awarded on any toggle. But `calculateResetPoints` at line 434 checks `habit.count >= habit.targetCount` = `0 >= 0 = true` and subtracts points that were never credited. Same issue in `habitProcessor.ts:138`.
- **Impact:** Threshold habits created with `targetCount = 0` (schema allows `number` with no minimum) silently never award points, then subtract phantom points on reset, drifting the total downward by one base-points amount per reset.
- **Effort:** S (hours) — apply the same `habit.targetCount > 0 ? habit.targetCount : 1` guard that the incremental branch already uses (line 349) to the threshold branch's `target` variable. Schema validation to prevent `targetCount: 0` on threshold habits is a complementary fix.
- **Risk:** LOW — only changes behavior for the degenerate `targetCount = 0` case which should not exist in production data.
- **Confidence:** HIGH — logic traced through the function directly.
- **Fix sketch:** At `utils/habitLogic.ts:371`, change `const target = habit.targetCount;` to `const target = habit.targetCount > 0 ? habit.targetCount : 1;`. Mirror at `habitProcessor.ts:138`.

---

## Test Coverage Findings

---

### [COVERAGE-01] `calculateSafeToSpendBreakdownFromExpanded` breakdown struct is never directly tested — labeled-field regressions are invisible

- **Evidence:** `utils/safeToSpendCalculator.test.ts` — all 18 tests call `calculateSafeToSpend` (the scalar wrapper), never `calculateSafeToSpendBreakdownFromExpanded` or `calculateSafeToSpendBreakdown`. The context exposes `safeToSpendBreakdown` (with named fields `checkingBalance`, `unpaidBills`, `pendingSpend`) to widgets. The UI in `SafeToSpendHero` and `SafeToSpendModal` reads these individual fields directly.
- **Impact:** If `unpaidBills` and `pendingSpend` were swapped, or either field were accidentally zeroed while `safeToSpend` remained correct, no test would catch it. The widgets would show wrong itemizations.
- **Effort:** S (hours) — add ~6 test cases calling `calculateSafeToSpendBreakdownFromExpanded` and asserting all four struct fields.
- **Risk:** LOW — tests only.
- **Confidence:** HIGH — confirmed by reading both the test file and the two exported functions.

---

### [COVERAGE-02] `hooks/useHabitActions.tsx` batch atomicity tests cover only `addHabitSubmission` — `toggleHabit`, `resetHabit`, `updateHabitSubmission`, `deleteHabitSubmission` are untested

- **Evidence:** `hooks/useHabitActions.test.tsx` — only `addHabitSubmission` (and its daily/weekly/total point delta) appears in the test file. The five other batch-level mutations are not exercised. The CLAUDE.md notes all five are supposed to commit in a single `writeBatch`.
- **Impact:** Regression in any of the four untested mutation paths (e.g., `toggleHabit` accidentally becomes non-atomic) would not be caught by CI. These are high-churn paths — they are the core of the gamification loop.
- **Effort:** M (a day-ish) — add batch-capture tests for `toggleHabit`, `resetHabit`, `updateHabitSubmission`, `deleteHabitSubmission` using the same hand-rolled Firestore mock pattern already established in the file.
- **Risk:** LOW — tests only; does not change production code.
- **Confidence:** HIGH — test file read end-to-end.

---

### [COVERAGE-03] No integration or E2E tests exist — the full onSnapshot→mutation→state round-trip is never exercised

- **Evidence:** No Cypress, Playwright, or Vitest browser-mode test files anywhere in the project. `FirebaseHouseholdContext.test.tsx` uses a hand-rolled Firestore mock that strips `.withConverter()` to a no-op; it tests batch atomicity but not converter round-trips or listener-driven state.
- **Impact:** Any regression that requires a real Firestore document to flow through a converter into React state and trigger a re-render is invisible to CI. The context test's mock cannot catch a converter bug (e.g., a field normalized to `undefined` causing a downstream crash) because it replaces the converter with an identity function.
- **Effort:** L (multi-day) — adding even a single Vitest browser-mode test with Firebase emulator would provide a meaningful integration baseline. A Playwright smoke test covering login → dashboard → add transaction would cover the highest-risk round-trip.
- **Risk:** LOW — tests only.
- **Confidence:** HIGH — confirmed no E2E framework present (no cypress/, no playwright/, no `@playwright/test` in `package.json`).

---

### [COVERAGE-04] `services/notificationService.ts` has zero test coverage

- **Evidence:** Glob search for `notificationService.test.ts` returns nothing. The service handles FCM token registration and push notification dispatch — platform-level side effects that are difficult to catch in code review.
- **Impact:** Regressions in notification registration (e.g., token not stored to Firestore, wrong permission-check path) are invisible to CI. Notifications are a planned monetization surface (habit reminders, budget alerts, streak warnings).
- **Effort:** M (a day-ish) — mock the Firebase messaging SDK and assert that token registration, notification dispatch, and error handling behave correctly.
- **Risk:** LOW — tests only.
- **Confidence:** HIGH — no test file found.

---

### [COVERAGE-05] `payCalendarItem` atomicity test exists but the recurring-income path (two-batch failure) is untested

- **Evidence:** `contexts/FirebaseHouseholdContext.test.tsx:223-265` — tests that `payCalendarItem` produces one batch with three ops (calendar item + account balance + transaction). This covers the expense case. The income path (where `handlePaycheckApproval` commits a prior batch) is not exercised; the test does not attempt to assert that no second batch sneaks in before the main one, or that a failure in the second batch leaves the system consistent.
- **Impact:** The two-batch failure mode described in CORRECTNESS-04 has no test regression guard. If it were accidentally fixed, there would be no test confirming the fix; if it regresses, no test catches it.
- **Effort:** S (hours) — add a test case with `item.type === 'income'` and assert that `handlePaycheckApproval` fires, plus a separate test that simulates second-batch failure and verifies the expected inconsistency (or, after CORRECTNESS-04 is fixed, that a single atomic path is used).
- **Risk:** LOW — tests only.
- **Confidence:** HIGH — test file read; income path not exercised.

---

## Coverage Summary

**Test files (project):** 32 `.test.ts` + 52 `.test.tsx` = 84 files (excluding node_modules)

**CI coverage gate:** Only `utils/**` is gated (≥78% lines/statements, ≥82% functions, ≥70% branches). No threshold for `contexts/`, `hooks/`, `services/`, `components/`, or `pages/`.

**Critical paths status:**

| Module | Test File | Coverage Quality |
|---|---|---|
| `utils/safeToSpendCalculator.ts` | ✅ `safeToSpendCalculator.test.ts` | Good breadth; missing breakdown-struct assertions (COVERAGE-01) |
| `utils/habitLogic.ts` | ✅ `habitLogic.test.ts` | Comprehensive; all major paths covered |
| `utils/money.ts` | ✅ `money.test.ts` | Complete |
| `utils/bucketSpentCalculator.ts` | ✅ `bucketSpentCalculator.test.ts` | Good; all helpers covered |
| `utils/firestoreConverters.ts` | ✅ `firestoreConverters.test.ts` | All 19 converters tested |
| `contexts/FirebaseHouseholdContext.tsx` | ✅ `FirebaseHouseholdContext.test.tsx` + `contextSplitIsolation.test.tsx` | Atomicity tested; converter round-trips not tested; income path not tested |
| `services/geminiService.ts` | ✅ 4 test files | Thorough; prompt templates not snapshot-tested |
| `hooks/useHabitActions.tsx` | ⚠️ `useHabitActions.test.tsx` | Only `addHabitSubmission` tested (COVERAGE-02) |
| `functions/src/quickAdd/streakLogic.ts` | ✅ (via `habitProcessor.test.ts`) | All helpers covered |
| `services/notificationService.ts` | ❌ No test file | HIGH risk, zero coverage (COVERAGE-04) |

**No E2E tests** — zero integration layer between the mocked unit tests and production Firestore (COVERAGE-03).

---

---

### [CORRECTNESS-11] `calendarItemConverter` does no Timestamp guard on `date` field — legacy docs silently drop bills from Safe-to-Spend

- **Evidence:** `utils/firestoreConverters.ts:123-124` — `calendarItemConverter.fromFirestore` returns `{ ...snapshot.data(), id: snapshot.id } as CalendarItem` with no per-field normalization. `accountConverter` (line 79), `habitConverter` (line 141), and `transactionConverter` all guard their Timestamp fields; `calendarItemConverter` does not. If a document was written with a Firestore `Timestamp` in the `date` field (older app versions before date strings were standardized), `parseISO(item.date)` at `safeToSpendCalculator.ts:23` receives a `Timestamp` object, returns `Invalid Date`, and `isAfter(invalidDate, …)` returns `false` — silently excluding the bill from unpaid-bills sum.
- **Impact:** Any legacy `CalendarItem` with a `Timestamp`-typed `date` field is silently dropped from Safe-to-Spend calculations. The metric is overstated. The user sees more available funds than reality — a financial safety issue with no error surfaced to the user.
- **Effort:** S (hours) — add a Timestamp-to-ISO guard in `calendarItemConverter.fromFirestore`, mirroring the existing `transactionConverter` pattern. Add a `firestoreConverters.test.ts` case for a `CalendarItem` with a `Timestamp`-typed `date`.
- **Risk:** LOW — purely additive normalization in a converter; no schema changes.
- **Confidence:** HIGH — code read directly; the pattern divergence from other converters is unambiguous. Severity is HIGH if any legacy documents exist in Firestore.
- **Fix sketch:** In `calendarItemConverter.fromFirestore`, destructure `data`, check if `data.date` is a `Timestamp` instance and convert via `.toDate()` then `format(date, 'yyyy-MM-dd')`, return the normalized object. Mirror the guard for `dueDate` and any other date-string fields.

---

### [CORRECTNESS-12] `safeToSpendCalculator` `endDate` equality check using `getTime()` is dead code when fallback `endOfMonth` is used

- **Evidence:** `utils/safeToSpendCalculator.ts:127` — `isBefore(itemDate, endDate) || itemDate.getTime() === endDate.getTime()`. `endOfMonth(paycheckA)` returns `23:59:59.999` local time; `parseISO('yyyy-MM-dd')` returns `00:00:00.000` local time. These can never be equal. The `getTime()` equality branch only has effect when `endDate = parseISO(paycheckBDate)` (both midnight), which is the normal case. When the fallback `endOfMonth` is used, the equality half is dead code — but `isBefore(midnight, 23:59:59.999)` is `true`, so end-of-month bills are still correctly captured by the `isBefore` branch.
- **Impact:** No bills are missed. The dead branch creates false confidence that end-boundary bills are captured by the equality check; they are in fact captured by `isBefore`. Low severity.
- **Effort:** S (hours) — replace the compound condition with `!isAfter(itemDate, endDate)` (equivalent but clearly expresses "on or before end date") and add a test case for a bill falling on the fallback `endOfMonth` date.
- **Risk:** LOW — behavior is equivalent; a test would confirm.
- **Confidence:** HIGH — traced the date arithmetic through date-fns.
- **Fix sketch:** Replace `isBefore(itemDate, endDate) || itemDate.getTime() === endDate.getTime()` with `!isAfter(itemDate, endDate)` throughout `calculateUnpaidBillsInRange`.

---

## Prioritized Finding Index

| ID | Title | Severity | Confidence | Effort |
|---|---|---|---|---|
| CORRECTNESS-01 | Server `processToggleHabit` wrong-sign points for negative habits | HIGH | HIGH | S |
| CORRECTNESS-03 | `handleExpense` voice path never debits checking account | HIGH | HIGH | S |
| CORRECTNESS-11 | `calendarItemConverter` no Timestamp guard on `date` — legacy bills silently dropped | HIGH | HIGH | S |
| CORRECTNESS-02 | `addTransaction` non-atomic two-step write | MED | HIGH | S |
| CORRECTNESS-08 | `calculatePointsForDate` skips historical completions after reset | MED | HIGH | S |
| CORRECTNESS-04 | `payCalendarItem` income: two sequential batches, partial-commit risk | MED | HIGH | L |
| CORRECTNESS-05 | `deferCalendarItem` recurring: two non-atomic addDocs | MED | HIGH | S |
| CORRECTNESS-06 | `markChallengeComplete` + yearly goal: two sequential writes | MED | HIGH | S |
| CORRECTNESS-07 | `toggleShoppingItemPurchased`: non-atomic two-step write | LOW | HIGH | S |
| CORRECTNESS-09 | Server `resetStaleHabit` doesn't strip today from `completedDates` | LOW | HIGH | S |
| CORRECTNESS-10 | Threshold habit with `targetCount === 0` never awards points, subtracts on reset | LOW | HIGH | S |
| CORRECTNESS-12 | `safeToSpendCalculator` `endDate` `getTime()` equality is dead code in `endOfMonth` fallback | LOW | HIGH | S |
| COVERAGE-01 | `calculateSafeToSpendBreakdownFromExpanded` struct never tested | MED | HIGH | S |
| COVERAGE-02 | `useHabitActions` batch atomicity tested for `addHabitSubmission` only | MED | HIGH | M |
| COVERAGE-03 | Zero E2E / integration coverage | MED | HIGH | L |
| COVERAGE-04 | `notificationService.ts` — zero test coverage | LOW | HIGH | M |
| COVERAGE-05 | `payCalendarItem` income path not covered by existing atomicity test | LOW | HIGH | S |
