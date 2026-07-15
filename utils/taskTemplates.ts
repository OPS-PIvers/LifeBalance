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
 * The `todos` Firestore security rule whitelist (`firestore.rules`) does not
 * currently include `points` among the writable fields on create/update —
 * writing it would be silently rejected by the rules, not by this function.
 * `TaskTemplateItem.points` is kept on the template purely for a future display
 * affordance until the rules are updated (see PR description / roadmap notes).
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
    }));
};
