/**
 * The "assign to the whole household" sentinel.
 *
 * `ToDo.assignedTo` being ABSENT is the canonical whole-household value — see
 * `useActionQueue`, which relies on it to scope the queue to the current member.
 * But a `<select>` cannot hold `undefined` as an option value, so every form
 * that offers the choice needs a placeholder string to stand in for it, and
 * must map that string back to `undefined` before writing.
 *
 * It lives here because BOTH the To-Dos page's task form and the Capture
 * drawer's To-Dos tab need it. It was briefly declared twice, which is a
 * silent-corruption hazard rather than a style problem: if the two spellings
 * ever drifted, the un-mapped one would be written to Firestore verbatim and
 * the task would appear assigned to a member uid that doesn't exist.
 */
export const WHOLE_HOUSEHOLD_ASSIGNEE = '__whole_household__';

/**
 * Map a form's assignee value to what `ToDo.assignedTo` should be: `undefined`
 * for the whole household (the field is then omitted from the payload), or the
 * member uid unchanged.
 */
export const resolveAssignedTo = (assignee: string): string | undefined =>
  assignee === WHOLE_HOUSEHOLD_ASSIGNEE ? undefined : assignee;
