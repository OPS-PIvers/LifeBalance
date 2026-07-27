import React from 'react';
import { AlertCircle, Calendar, User } from 'lucide-react';
import { HouseholdMember } from '@/types/schema';
import { useAutoFocus } from '@/hooks/useAutoFocus';
import { getLocalDateString } from '@/utils/dateHelpers';
import { WHOLE_HOUSEHOLD_ASSIGNEE } from '@/utils/todoAssignee';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { CollapsibleSection } from '@/components/ui/CollapsibleSection';
import { CategoryChipPicker } from '@/components/ui/CategoryChipPicker';

// The "whole household" sentinel is shared with `pages/ToDosPage.tsx`'s task
// form — see utils/todoAssignee.ts for why it must have exactly one definition.

interface CaptureTodoTabProps {
  /** Id put on the `<form>` so the Drawer's footer Save button can target it. */
  formId: string;
  text: string;
  setText: (value: string) => void;
  date: string;
  setDate: (value: string) => void;
  /** A member uid, or `WHOLE_HOUSEHOLD_ASSIGNEE`. */
  assignee: string;
  setAssignee: (value: string) => void;
  members: HouseholdMember[];
  /** F-TODO-16 — the household's to-do category vocabulary. */
  categories: string[];
  /** F-TODO-16 — chosen category, or undefined for "Uncategorized" (the
   *  canonical absent value; the parent must not write ''). */
  category: string | undefined;
  setCategory: (value: string | undefined) => void;
  /** Persists a newly minted category name to the household vocabulary. */
  onAddCategory: (name: string) => Promise<void>;
  onSubmit: (e: React.FormEvent) => void;
}

/**
 * Capture drawer → To-Dos tab.
 *
 * ONE field is the whole fast path, matching the To-Dos page's sticky
 * quick-add bar: type a task, hit Save, and it lands due TODAY assigned to you
 * (the parent seeds those defaults). Due date / assignee / category are real
 * but secondary, so they live behind a collapsed "Add details" disclosure whose
 * collapsed summary states exactly what will be saved — anything set in there
 * wins over the default.
 */
export const CaptureTodoTab: React.FC<CaptureTodoTabProps> = ({
  formId,
  text,
  setText,
  date,
  setDate,
  assignee,
  setAssignee,
  members,
  categories,
  category,
  setCategory,
  onAddCategory,
  onSubmit,
}) => {
  const taskInputRef = useAutoFocus<HTMLInputElement>();

  // Collapsed summary — keeps the invisible defaults honest ("Today · Alex")
  // so the one-field path never saves something the user couldn't see.
  const dueLabel = !date
    ? 'No due date'
    : date === getLocalDateString()
      ? 'Today'
      : date;
  const assigneeLabel =
    assignee === WHOLE_HOUSEHOLD_ASSIGNEE
      ? 'Whole household'
      : members.find(m => m.uid === assignee)?.displayName?.split(' ')[0] ?? 'Unassigned';
  const detailSummary = [dueLabel, assigneeLabel, category].filter(Boolean).join(' · ');

  return (
    <form
      id={formId}
      onSubmit={onSubmit}
      className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-(--duration-base)"
      noValidate
    >
      <Input
        ref={taskInputRef}
        label="Task"
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Add a task…"
        autoComplete="off"
      />

      <CollapsibleSection
        title="Add details"
        subtitle="Due date, assignee & category"
        summary={detailSummary}
        defaultOpen={false}
      >
        <div className="space-y-4">
          <Input
            label="Due date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            icon={<Calendar size={18} />}
            className="appearance-none"
          />

          {members.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-brand-400 dark:text-brand-450 py-2">
              <AlertCircle size={16} className="shrink-0" />
              <span>No household members available to assign this task.</span>
            </div>
          ) : (
            <Select
              label="Assign to"
              icon={<User size={18} />}
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
            >
              {/* Sentinels keep the rendered value honest: without them an
                  empty or orphaned (member left) assignee would visually snap
                  to the first member while state still held the old value.
                  Mirrors the To-Dos page's task form. */}
              {assignee === '' && (
                <option value="" disabled>Choose a member</option>
              )}
              {assignee !== '' &&
                assignee !== WHOLE_HOUSEHOLD_ASSIGNEE &&
                !members.some(m => m.uid === assignee) && (
                  <option value={assignee} disabled>Former member</option>
                )}
              <option value={WHOLE_HOUSEHOLD_ASSIGNEE}>Whole household</option>
              {members.map(member => (
                <option key={member.uid} value={member.uid}>
                  {member.displayName ?? 'User'}
                </option>
              ))}
            </Select>
          )}

          <CategoryChipPicker
            label="Category (optional)"
            categories={categories}
            value={category}
            onChange={setCategory}
            onAddCategory={onAddCategory}
            allowClear
          />
        </div>
      </CollapsibleSection>
    </form>
  );
};
