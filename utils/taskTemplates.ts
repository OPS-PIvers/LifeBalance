import { TaskTemplate, ToDo } from '@/types/schema';

/**
 * F-TODO-03 — Task templates ("Quick Task Lists").
 *
 * Pure builder: given a TaskTemplate and today's local date, produces the set
 * of to-do payloads to create — one per template item. `assignedTo` falls back
 * to `fallbackAssignee` (the applying user) when the item has no explicit
 * assignee, mirroring the roadmap's "assignedTo falling back to the current
 * user" note.
 *
 * NOTE: `points` is intentionally NOT copied onto the created to-do payload.
 * This is a deliberate product decision, not a rules limitation — the `todos`
 * Firestore rules whitelist (`firestore.rules`) already permits writing
 * `points` (it drives kid-mode allowance-style completion credit, see
 * `utils/todoPoints.ts`), so a copied value would persist fine if written.
 * `TaskTemplateItem.points` is kept on the template purely for a future display
 * affordance; spawning to-dos with a template-authored, credit-bearing points
 * value is a separate piece of work not yet designed (see PR description /
 * roadmap notes).
 */
export const buildToDosFromTemplate = (
  template: TaskTemplate,
  today: string,
  fallbackAssignee: string
): Omit<ToDo, 'id' | 'createdAt' | 'createdBy'>[] => {
  return template.items
    .filter(item => item.text.trim().length > 0)
    .map(item => ({
      text: item.text.trim(),
      completeByDate: today,
      assignedTo: item.assignedTo || fallbackAssignee,
      isCompleted: false,
      source: 'manual' as const,
      // F-TODO-16 — a template item's category carries onto the spawned to-do
      // (unlike `points` above, which is withheld by product choice rather
      // than a rules gap — both fields are equally writable). Omitted rather
      // than written as '' when blank: absence is the canonical
      // "Uncategorized" representation.
      ...(item.category?.trim() ? { category: item.category.trim() } : {}),
    }));
};
