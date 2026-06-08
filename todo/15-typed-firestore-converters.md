# 15 — Typed Firestore converters (kill the `d.data() as T` casts)

## Problem
Every collection listener and `getDoc` deserializes raw `DocumentData` with an unchecked
`as DomainType` cast. Missing or wrong-typed Firestore fields are silently `undefined` at runtime and
only surface much later as a `NaN`/crash in a consumer. There are ~30 such casts in production code.

## Current state (representative)
- `contexts/FirebaseHouseholdContext.tsx` — `snapshot.docs.map(d => ({ ...d.data(), id: d.id } as BudgetBucket))`
  and siblings at lines ~732, 746, 765, 791, 800, 809, 818, 875, 920, 929, 938, 953, 1002, 1190, 1310, 1328, 1374.
- `hooks/useHabitActions.tsx:398,484` — `submissionSnap.data() as HabitSubmission`.
- `services/geminiService.ts:137,176` — `snap.data() as Household`.
- `components/modals/DeveloperConsole.tsx:37,41,45`; `functions/src/index.ts:167,219`.

## Proposed approach
- Define a `FirestoreDataConverter<T>` (`toFirestore`/`fromFirestore`) per major collection (Habit,
  Transaction, BudgetBucket, CalendarItem, HouseholdMember, Meal, ShoppingItem, …), centralized in a
  new `utils/firestoreConverters.ts`.
- Attach via `.withConverter(converter)` at the collection-reference level inside the context so
  listeners/readers return typed `T` with no cast.
- `fromFirestore` does light runtime validation/defaulting (e.g. coerce missing numeric fields,
  drop the deprecated `BudgetBucket.spent`) so bad documents fail loudly/consistently.

## Risks
- Behavior change if a converter "fixes up" a field a consumer relied on being `undefined`.
- Large surface area; do it collection-by-collection with tests, not in one sweep.
- The `functions/` package needs its own (admin-SDK) converters — separate compile target.

## Acceptance criteria
- No `as <DomainType>` casts on `d.data()` in the migrated collections.
- Each converter has unit tests covering a well-formed doc and a partial/legacy doc.
- Runtime behavior unchanged for valid data; `pnpm lint` + `pnpm test` + build green.
