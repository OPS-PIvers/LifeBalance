# Eisenhower Matrix To-Do View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a list⇄matrix toggle to the Active to-do view that arranges tasks into Eisenhower quadrants (urgent × important), backed by a new `isImportant` flag settable via a star on every row and in the add/edit drawer.

**Architecture:** `isImportant?: boolean` on `ToDo` (absent = false, no migration); a pure `utils/eisenhower.ts` whose urgency predicate is identical to the list view's "Immediate" section; the matrix arrangement reuses the existing `Section`/`TodoRow` components in `pages/ToDosPage.tsx`; view choice persisted in localStorage.

**Tech Stack:** React 19 + TypeScript strict, Vitest, date-fns, Tailwind v4 tokens (DESIGN.md), lucide-react icons. Spec: `docs/superpowers/specs/2026-07-06-eisenhower-matrix-design.md`.

**Conventions that apply to every task:** pnpm (never npm); `@/` path aliases for cross-directory imports; no lint/type suppressions; `pnpm lint` runs tsc so type errors fail; branch `feat/eisenhower-matrix-view` already exists and is checked out.

---

### Task 1: Schema field + converter round-trip test

**Files:**
- Modify: `types/schema.ts` (ToDo interface, ~line 626)
- Test: `utils/firestoreConverters.test.ts` (todoConverter describe block, ~line 818)

- [ ] **Step 1: Add the field to the ToDo interface**

In `types/schema.ts`, inside `export interface ToDo`, after the `points?: number;` field add:

```typescript
  // Eisenhower matrix (spec 2026-07-06): human judgment of importance, set via
  // the star toggle. Absent/false = not important — no migration needed.
  // Urgency is NOT stored; it is derived from completeByDate (utils/eisenhower.ts).
  isImportant?: boolean;
```

- [ ] **Step 2: Write the round-trip test (expected to pass immediately — converter spreads fields)**

In `utils/firestoreConverters.test.ts`, add inside `describe('todoConverter', ...)` after the last `it`:

```typescript
  it('(a) isImportant round-trips through both directions', () => {
    const fromDb = todoConverter.fromFirestore(fakeSnap('todo-6', { ...wellFormed, isImportant: true }));
    expect(fromDb.isImportant).toBe(true);
    const out = callToFirestore(todoConverter, { ...wellFormed, id: 'todo-6', isImportant: true });
    expect(out['isImportant']).toBe(true);
  });

  it('(b) isImportant stays undefined when absent (legacy docs)', () => {
    const result = todoConverter.fromFirestore(fakeSnap('todo-7', wellFormed));
    expect(result.isImportant).toBeUndefined();
  });
```

- [ ] **Step 3: Run the converter tests**

Run: `pnpm test utils/firestoreConverters.test.ts`
Expected: PASS (converter already spreads `...d` in fromFirestore and only strips `id` in toFirestore).

- [ ] **Step 4: Commit**

```bash
git add types/schema.ts utils/firestoreConverters.test.ts
git commit -m "feat(todos): add isImportant field to ToDo schema"
```

---

### Task 2: Pure quadrant logic — `utils/eisenhower.ts` (TDD)

**Files:**
- Create: `utils/eisenhower.ts`
- Create: `utils/eisenhower.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `utils/eisenhower.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { isUrgent, quadrantForTodo, QUADRANT_ORDER } from './eisenhower';
import { ToDo } from '@/types/schema';

// Fixed "today" for deterministic boundaries (a Wednesday).
const TODAY = new Date(2026, 6, 8); // 2026-07-08 local

const makeTodo = (overrides: Partial<ToDo>): ToDo => ({
  id: 't1',
  text: 'Test task',
  completeByDate: '2026-07-08',
  assignedTo: 'u1',
  isCompleted: false,
  createdBy: 'u1',
  createdAt: '2026-07-01T10:00:00.000Z',
  ...overrides,
});

describe('isUrgent', () => {
  // Must match the list view's "Immediate" section: overdue, today, or tomorrow.
  it('overdue (yesterday) is urgent', () => {
    expect(isUrgent(makeTodo({ completeByDate: '2026-07-07' }), TODAY)).toBe(true);
  });
  it('due today is urgent', () => {
    expect(isUrgent(makeTodo({ completeByDate: '2026-07-08' }), TODAY)).toBe(true);
  });
  it('due tomorrow is urgent', () => {
    expect(isUrgent(makeTodo({ completeByDate: '2026-07-09' }), TODAY)).toBe(true);
  });
  it('due day after tomorrow is NOT urgent', () => {
    expect(isUrgent(makeTodo({ completeByDate: '2026-07-10' }), TODAY)).toBe(false);
  });
});

describe('quadrantForTodo', () => {
  it('urgent + important → do', () => {
    expect(quadrantForTodo(makeTodo({ completeByDate: '2026-07-08', isImportant: true }), TODAY)).toBe('do');
  });
  it('not urgent + important → schedule', () => {
    expect(quadrantForTodo(makeTodo({ completeByDate: '2026-07-20', isImportant: true }), TODAY)).toBe('schedule');
  });
  it('urgent + not important → delegate', () => {
    expect(quadrantForTodo(makeTodo({ completeByDate: '2026-07-08', isImportant: false }), TODAY)).toBe('delegate');
  });
  it('not urgent + not important → later', () => {
    expect(quadrantForTodo(makeTodo({ completeByDate: '2026-07-20' }), TODAY)).toBe('later');
  });
  it('missing isImportant is treated as not important', () => {
    expect(quadrantForTodo(makeTodo({ completeByDate: '2026-07-08' }), TODAY)).toBe('delegate');
  });
});

describe('QUADRANT_ORDER', () => {
  it('renders do, schedule, delegate, later in that order', () => {
    expect(QUADRANT_ORDER).toEqual(['do', 'schedule', 'delegate', 'later']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test utils/eisenhower.test.ts`
Expected: FAIL — "Cannot find module './eisenhower'" (or equivalent resolve error).

- [ ] **Step 3: Write the implementation**

Create `utils/eisenhower.ts`:

```typescript
import { parseISO, isBefore, addDays } from 'date-fns';
import { ToDo } from '@/types/schema';

/**
 * Eisenhower matrix quadrants (spec 2026-07-06).
 * - Urgency is DERIVED from completeByDate with the exact same window as the
 *   list view's "Immediate" section (overdue | today | tomorrow), so the two
 *   views always agree on what is urgent.
 * - Importance is the explicit human-set ToDo.isImportant flag (absent = false).
 */
export type Quadrant = 'do' | 'schedule' | 'delegate' | 'later';

/** Render order: most actionable first. */
export const QUADRANT_ORDER: readonly Quadrant[] = ['do', 'schedule', 'delegate', 'later'];

/**
 * Urgent = overdue, due today, or due tomorrow — i.e. due strictly before the
 * day after tomorrow. Expressed as pure math against the `today` parameter
 * (the caller's local start-of-day; ToDosPage's midnight-refreshed
 * currentDate) so the function is deterministic and testable with a fixed
 * date — deliberately NOT date-fns isToday/isTomorrow, which read the real
 * clock and would ignore the parameter.
 */
export function isUrgent(todo: ToDo, today: Date): boolean {
  const due = parseISO(todo.completeByDate);
  return isBefore(due, addDays(today, 2));
}

export function quadrantForTodo(todo: ToDo, today: Date): Quadrant {
  const urgent = isUrgent(todo, today);
  const important = todo.isImportant === true;
  if (urgent && important) return 'do';
  if (important) return 'schedule';
  if (urgent) return 'delegate';
  return 'later';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test utils/eisenhower.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add utils/eisenhower.ts utils/eisenhower.test.ts
git commit -m "feat(todos): pure Eisenhower quadrant logic with urgency matching Immediate section"
```

---

### Task 3: Star toggle — row + add/edit drawer

**Files:**
- Modify: `pages/ToDosPage.tsx`

All changes in this task are UI wiring in one file; the app has no page-level test harness for ToDosPage, so verification is `pnpm lint` + the existing suite + Test Mode walkthrough in Task 5.

- [ ] **Step 1: Import Star icon and add the importance form state**

In the lucide-react import (line 4), add `Star` to the list.

In the form-state block (after `const [assignedTo, setAssignedTo] = useState('');`, ~line 117) add:

```typescript
  const [isImportant, setIsImportant] = useState(false);
```

- [ ] **Step 2: Wire form state into open/submit handlers**

In `openAddModal` (~line 233), after `setAssignedTo(defaultAssignee);` add:

```typescript
    setIsImportant(false);
```

In `openEditModal` (~line 275), after `setAssignedTo(todo.assignedTo);` add:

```typescript
    setIsImportant(todo.isImportant === true);
```

In `handleSubmit` (~line 434), add `isImportant` to BOTH payloads:

```typescript
        await updateToDo(editingId, {
          text: trimmedText,
          completeByDate,
          assignedTo,
          isImportant
        });
```

```typescript
        await addToDo({
          text: trimmedText,
          completeByDate,
          assignedTo,
          isCompleted: false,
          isImportant
        });
```

- [ ] **Step 3: Add the Important toggle field to the drawer form**

In the Add/Edit Drawer form, between the Due Date `<Input>` and the Assign-to `<fieldset>`, insert:

```tsx
          {/* Eisenhower importance — a household judgment call, deliberately a
              yes/no (not low/med/high) to match the matrix's two-state axis. */}
          <button
            type="button"
            onClick={() => setIsImportant(v => !v)}
            aria-pressed={isImportant}
            className={cn(
              'w-full flex items-center gap-3 px-3 py-3 rounded-btn border text-left transition-colors duration-(--duration-fast) ease-(--ease-standard)',
              isImportant
                ? 'bg-warm-100 border-warm-500/40 dark:bg-warm-500/15 dark:border-warm-500/40'
                : 'bg-white border-brand-200 hover:bg-brand-50 dark:bg-brand-700/50 dark:border-brand-600 dark:hover:bg-brand-700'
            )}
          >
            <Star
              size={20}
              aria-hidden="true"
              className={isImportant ? 'text-warm-500 fill-warm-500' : 'text-brand-300 dark:text-brand-500'}
            />
            <span className="flex-1 min-w-0">
              <span className={cn('block text-sm font-medium', isImportant ? 'text-warm-700 dark:text-warm-300' : 'text-brand-900 dark:text-brand-50')}>
                Important
              </span>
              <span className="block text-xs text-brand-400 dark:text-brand-450">
                Matters to the family — big consequences if skipped
              </span>
            </span>
          </button>
```

- [ ] **Step 4: Add the star toggle to every active TodoRow**

`TodoRow` needs a toggle handler. Add to `TodoRowProps`:

```typescript
  onToggleImportant: (todo: ToDo) => void;
```

and destructure `onToggleImportant` in the `TodoRow` component signature.

In the row's actions area, the star must be visible in BOTH desktop and mobile
(it's the one-tap triage affordance). Insert it as the FIRST element inside the
`{!isSelectionMode && (` fragment, BEFORE the desktop-actions div (so it renders
at all widths):

```tsx
            {/* Importance star — always visible (not hover-gated): one-tap
                family triage is the core Eisenhower workflow. */}
            <Button
              variant="ghost-brand"
              size="icon"
              onClick={(e) => { e.stopPropagation(); onToggleImportant(item); }}
              aria-label={item.isImportant ? `Unmark important: ${item.text}` : `Mark important: ${item.text}`}
              aria-pressed={item.isImportant === true}
              title={item.isImportant ? 'Unmark important' : 'Mark important'}
              className="self-center"
            >
              <Star
                size={18}
                className={item.isImportant ? 'text-warm-500 fill-warm-500' : 'text-brand-300 dark:text-brand-500'}
              />
            </Button>
```

- [ ] **Step 5: Thread the handler through Section to TodoRow**

In `SectionProps` add:

```typescript
  onToggleImportant: (todo: ToDo) => void;
```

Destructure `onToggleImportant` in the `Section` component signature, pass it to
each `<TodoRow ... onToggleImportant={onToggleImportant} />`, and add
`prev.onToggleImportant === next.onToggleImportant &&` to the `sameOtherProps`
comparator alongside the other callback checks.

In the page component, add the handler near `handleMoveToTomorrow` (~line 312):

```typescript
  const handleToggleImportant = useCallback(async (todo: ToDo) => {
      const next = todo.isImportant !== true;
      try {
          await updateToDo(todo.id, { isImportant: next });
          haptic('light');
      } catch (error) {
          console.error('Failed to update importance:', error);
          toast.error('Failed to update importance');
      }
  }, [updateToDo]);
```

Pass `onToggleImportant={handleToggleImportant}` to all three existing
`<Section>` call sites (Immediate, Upcoming, On the Radar).

- [ ] **Step 6: Lint and run the suite**

Run: `pnpm lint && pnpm test`
Expected: both green (tsc strict will catch any missed prop threading).

- [ ] **Step 7: Commit**

```bash
git add pages/ToDosPage.tsx
git commit -m "feat(todos): importance star toggle on rows and in the task drawer"
```

---

### Task 4: Matrix arrangement + list⇄matrix toggle

**Files:**
- Modify: `pages/ToDosPage.tsx`

- [ ] **Step 1: Add imports and the persisted arrangement state**

Add to imports: `LayoutGrid`, `List` from lucide-react; and

```typescript
import { quadrantForTodo, QUADRANT_ORDER, type Quadrant } from '@/utils/eisenhower';
```

After the `viewMode` state (~line 50) add:

```typescript
  // Active-view arrangement: chronological list vs Eisenhower matrix.
  // Persisted per-device — this is a personal lens on shared data.
  const ARRANGEMENT_KEY = 'lifebalance:todos-view';
  const [arrangement, setArrangement] = useState<'list' | 'matrix'>(() => {
    try {
      return localStorage.getItem(ARRANGEMENT_KEY) === 'matrix' ? 'matrix' : 'list';
    } catch {
      return 'list'; // storage unavailable (private browsing) — default lens
    }
  });
  const setArrangementPersisted = useCallback((next: 'list' | 'matrix') => {
    setArrangement(next);
    try {
      localStorage.setItem(ARRANGEMENT_KEY, next);
    } catch {
      // non-fatal: the toggle still works for this session
    }
  }, []);
```

- [ ] **Step 2: Compute the quadrant buckets**

After the existing active-categorization `useMemo` (~line 172) add:

```typescript
  // Eisenhower buckets — computed unconditionally (hooks rule) but only
  // rendered in the matrix arrangement. Urgency uses the same midnight-
  // refreshed currentDate as the list sections, so the views always agree.
  const quadrants = useMemo(() => {
    const buckets: Record<Quadrant, ToDo[]> = { do: [], schedule: [], delegate: [], later: [] };
    todos.forEach(todo => {
      if (todo.isCompleted) return;
      buckets[quadrantForTodo(todo, currentDate)].push(todo);
    });
    const byDueDate = (a: ToDo, b: ToDo) => a.completeByDate.localeCompare(b.completeByDate);
    QUADRANT_ORDER.forEach(q => buckets[q].sort(byDueDate));
    return buckets;
  }, [todos, currentDate]);
```

- [ ] **Step 3: Add the quadrant section config**

Above the page component's `return`, alongside `menuItems`, add:

```typescript
  // Quadrant display config. Colors are existing Section colors (rose/amber/
  // blue) plus the two added in this task (accent/neutral) — all DESIGN.md
  // token families, no new palette entries.
  const QUADRANT_SECTIONS: Record<Quadrant, { title: string; subtitle: string; color: SectionColor }> = {
    do: { title: 'Do First', subtitle: 'Urgent & Important', color: 'rose' },
    schedule: { title: 'Schedule', subtitle: 'Important, Not Urgent', color: 'accent' },
    delegate: { title: 'Delegate', subtitle: 'Urgent, Not Important', color: 'amber' },
    later: { title: 'Later', subtitle: 'Not Urgent, Not Important', color: 'neutral' },
  };
```

- [ ] **Step 4: Extend Section's color union**

The `Section`/`TodoRow` color prop is currently `'rose' | 'amber' | 'blue'`.
Extract and extend it. Near `TodoRowProps` (~line 1020) add:

```typescript
type SectionColor = 'rose' | 'amber' | 'blue' | 'accent' | 'neutral';
```

Replace the inline `color: 'rose' | 'amber' | 'blue';` in BOTH `TodoRowProps`
and `SectionProps` with `color: SectionColor;`.

Extend `dateColorMap` (~line 1037):

```typescript
const dateColorMap = {
  rose: 'text-money-neg dark:text-money-negDark',
  amber: 'text-warm-700 dark:text-warm-300',
  blue: 'text-habit-blue dark:text-habit-blue',
  accent: 'text-accent-600 dark:text-accent-300',
  neutral: 'text-brand-500 dark:text-brand-400',
} as const;
```

Extend `sectionDotColors` inside `Section` (~line 1291):

```typescript
  const sectionDotColors = {
    rose: 'bg-money-neg',
    amber: 'bg-warm-500',
    blue: 'bg-habit-blue',
    accent: 'bg-accent-600',
    neutral: 'bg-brand-400',
  };
```

- [ ] **Step 5: Add the arrangement toggle to the header**

Inside the header, immediately after the `</Tabs>` closing tag (still inside
the `{!isSelectionMode && (...)}` block — wrap both in a fragment):

```tsx
              <Button
                variant="ghost-brand"
                size="icon"
                onClick={() => setArrangementPersisted(arrangement === 'list' ? 'matrix' : 'list')}
                aria-label={arrangement === 'list' ? 'Switch to matrix view' : 'Switch to list view'}
                title={arrangement === 'list' ? 'Matrix view (Eisenhower)' : 'List view'}
                className="shrink-0"
              >
                {arrangement === 'list' ? <LayoutGrid size={18} /> : <List size={18} />}
              </Button>
```

Note: the toggle stays visible in the Completed tab (it flips what Active will
show when you return) — simpler than conditionally hiding it, and harmless.

- [ ] **Step 6: Render the matrix arrangement**

The Active branch currently renders the three chronological sections. Extract
the quick-add `addRow` JSX into a variable so both arrangements share it —
directly above the `return`, add:

```tsx
  const quickAddRow = !isSelectionMode ? (
    <div className="flex items-center gap-2">
      <QuickAddBar
        attached
        onSubmit={handleQuickAdd}
        inputRef={quickAddRef}
        value={quickText}
        onChange={setQuickText}
        placeholder="Add a task..."
        aria-label="Quick add task"
        disabled={!quickText.trim()}
        submitLabel="Add task"
      />
      <button
        type="button"
        onClick={openAddModal}
        aria-label="Add new task"
        title="Add with date & assignee"
        className="flex-none flex items-center justify-center p-3 mr-2 rounded-btn text-brand-600 hover:text-brand-900 hover:bg-brand-100 dark:text-brand-300 dark:hover:text-brand-50 dark:hover:bg-brand-700/50 transition-colors duration-(--duration-fast) ease-(--ease-standard)"
      >
        <SlidersHorizontal className="w-5 h-5" />
      </button>
    </div>
  ) : undefined;
```

Replace the Immediate section's inline `addRow={...}` with `addRow={quickAddRow}`.

Then wrap the three existing list sections in `{arrangement === 'list' ? (...) : (...)}`
inside the Active branch, with the matrix alternative:

```tsx
              {QUADRANT_ORDER.map((q, idx) => (
                <Section
                  key={q}
                  title={QUADRANT_SECTIONS[q].title}
                  subtitle={QUADRANT_SECTIONS[q].subtitle}
                  items={quadrants[q]}
                  color={QUADRANT_SECTIONS[q].color}
                  maxVisible={q === 'later' ? 5 : undefined}
                  onComplete={completeToDo}
                  onEdit={openEditModal}
                  onDelete={deleteToDo}
                  onDuplicate={handleDuplicate}
                  onMoveToTomorrow={handleMoveToTomorrow}
                  onToggleImportant={handleToggleImportant}
                  onMore={setActionTodo}
                  memberMap={memberMap}
                  isSelectionMode={isSelectionMode}
                  selectedIds={selectedIds}
                  onToggleSelection={toggleSelection}
                  addRow={idx === 0 ? quickAddRow : undefined}
                />
              ))}
```

The existing "All caught up" empty-state paragraph stays where it is and
applies to both arrangements (its condition — all three list buckets empty —
is equivalent to all four quadrants being empty, since both partition the same
active set).

- [ ] **Step 7: Lint, test, build**

Run: `pnpm lint && pnpm test`
Expected: green.

- [ ] **Step 8: Commit**

```bash
git add pages/ToDosPage.tsx
git commit -m "feat(todos): Eisenhower matrix arrangement with list/matrix toggle"
```

---

### Task 5: Test Mode seed + visual verification

**Files:**
- Modify: `contexts/MockHouseholdContext.tsx` (todos seed, ~line 290)

- [ ] **Step 1: Seed an important todo and a non-urgent one**

In the `useState<ToDo[]>` initializer, after the existing `todo_kid_1` entry add
(note `addDays` and `format` from date-fns are ALREADY imported in this file —
verify with a quick grep, and if not, use plain Date math consistent with the
file's existing imports):

```typescript
    {
      id: 'todo_important_1',
      text: 'Renew car insurance',
      completeByDate: getLocalDateString(), // urgent + important → Do First
      assignedTo: 'test-user-id',
      isCompleted: false,
      isImportant: true,
      createdBy: 'test-user-id',
      createdAt: new Date().toISOString(),
    },
    {
      id: 'todo_schedule_1',
      text: 'Plan summer vacation',
      // ~3 weeks out: not urgent + important → Schedule
      completeByDate: format(addDays(new Date(), 21), 'yyyy-MM-dd'),
      assignedTo: 'test-user-id',
      isCompleted: false,
      isImportant: true,
      createdBy: 'test-user-id',
      createdAt: new Date().toISOString(),
    },
```

If `format`/`addDays` are not already imported in MockHouseholdContext.tsx, add
them to its existing `date-fns` import (or create one following the file's
import style).

- [ ] **Step 2: Full suite**

Run: `pnpm lint && pnpm test`
Expected: green.

- [ ] **Step 3: Visual verification in Test Mode (MANDATORY per project memory)**

Start the dev server via the preview tools (`.claude/launch.json` exists) and
open `http://localhost:3000/#/login?test=true` (requires
`VITE_ENABLE_TEST_MODE=true` in `.env.local`). Then verify with DOM-based
tools (preview_snapshot / preview_inspect — screenshots time out in this
environment) plus a final screenshot attempt, in BOTH light and dark
(preview_resize colorScheme) at mobile width:

- To-Dos page shows the list⇄grid toggle next to Active/Completed tabs.
- Toggling shows 4 quadrant sections: Do First (rose, contains "Make your bed"
  and "Renew car insurance"), Schedule (accent, "Plan summer vacation"),
  Delegate/Later per remaining seeds; quick-add bar is row one of Do First.
- Tapping a row's star moves the task between quadrants immediately.
- Star toggle appears in the add/edit drawer and round-trips on edit.
- Reload: arrangement choice persists.
- List view unchanged; Completed tab unchanged.

- [ ] **Step 4: Commit**

```bash
git add contexts/MockHouseholdContext.tsx
git commit -m "test(todos): seed important todos for Eisenhower matrix walkthrough"
```

---

### Task 6: Ship

- [ ] **Step 1: Final full verification**

Run: `pnpm lint && pnpm test && pnpm run build`
Expected: all green.

- [ ] **Step 2: Push and open PR**

Use `gh --body-file` (PowerShell mangles inline quotes — project memory):

```bash
git push -u origin feat/eisenhower-matrix-view
# Write PR body to a temp file first, then:
gh pr create --title "feat(todos): Eisenhower matrix view with importance star" --body-file <path-to-body-file>
```

PR body should cover: the isImportant field (no migration), urgency = Immediate
predicate, per-device localStorage arrangement, and the Test Mode walkthrough.
End the body with:

🤖 Generated with [Claude Code](https://claude.com/claude-code)

- [ ] **Step 3: Before merging**

Fetch and address gemini-code-assist review comments (project memory: CI-green
≠ reviewed). Known false positive to reject if raised: `outline-hidden` is
CORRECT for Tailwind v4 (do not change to `outline-none`). Merge via
`gh pr merge --squash` once CI (`validate`) is green and review is addressed;
main auto-deploys.
