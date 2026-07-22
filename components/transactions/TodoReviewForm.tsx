import React, { useState } from 'react';
import { AlertCircle, Calendar, Check, Star, Trash2, User } from 'lucide-react';
import toast from 'react-hot-toast';
import { showDeleteConfirmation } from '@/utils/toastHelpers';
import { ToDo } from '@/types/schema';
import { useTodos, useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { cn } from '@/utils/cn';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';

export interface TodoReviewFormProps {
  /** The held-for-review to-do being reviewed. */
  item: ToDo;
  /** Called after a successful approve (or a delete when no `onDeleted`). */
  onDone: () => void;
  /** Called after a successful delete; falls back to `onDone` when omitted. */
  onDeleted?: () => void;
}

/**
 * The per-item review form for a held-for-review to-do capture
 * (`ToDo.needsReview === true` — see utils/captureReview.ts). Mounted by the
 * cycling review drawer (Layer 3b) alongside TransactionReviewForm and
 * ShoppingReviewForm, and shares their conventions: every field is editable
 * inline, a single primary CTA approves (persisting any edits AND clearing
 * `needsReview` in one write), and a secondary confirm-gated row deletes.
 *
 * Field set mirrors ToDosPage's add/edit drawer core fields: task text, due
 * date, assignee, and the Eisenhower "Important" toggle.
 */
const TodoReviewForm: React.FC<TodoReviewFormProps> = ({ item, onDone, onDeleted }) => {
  const { approveTodo, deleteToDo } = useTodos();
  const { members } = useHouseholdCore();

  const [text, setText] = useState(() => item.text);
  const [completeByDate, setCompleteByDate] = useState(() => item.completeByDate);
  const [assignedTo, setAssignedTo] = useState(() => item.assignedTo);
  const [isImportant, setIsImportant] = useState(() => item.isImportant === true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const trimmedText = text.trim();
  const canApprove = trimmedText !== '' && completeByDate !== '';

  const handleApprove = async () => {
    if (!trimmedText) {
      toast.error('Task description is required');
      return;
    }
    if (!completeByDate) {
      toast.error('Due date is required');
      return;
    }

    const overrides: Partial<Pick<ToDo, 'text' | 'completeByDate' | 'assignedTo' | 'isImportant'>> = {};
    if (trimmedText !== item.text) overrides.text = trimmedText;
    if (completeByDate !== item.completeByDate) overrides.completeByDate = completeByDate;
    if (assignedTo !== item.assignedTo) overrides.assignedTo = assignedTo;
    if (isImportant !== (item.isImportant === true)) overrides.isImportant = isImportant;

    setIsSubmitting(true);
    try {
      await approveTodo(item.id, Object.keys(overrides).length > 0 ? overrides : undefined);
      onDone();
    } catch (error) {
      console.error('Failed to approve to-do:', error);
      toast.error('Failed to approve task');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = () => {
    showDeleteConfirmation(async () => {
      setIsSubmitting(true);
      try {
        await deleteToDo(item.id);
        (onDeleted ?? onDone)();
      } finally {
        setIsSubmitting(false);
      }
    }, trimmedText || 'task');
  };

  return (
    <div className="space-y-4">
      <Input
        label="Task"
        type="text"
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Enter task description"
        autoFocus
      />

      <Input
        label="Due date"
        type="date"
        value={completeByDate}
        onChange={e => setCompleteByDate(e.target.value)}
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
          value={assignedTo}
          onChange={e => setAssignedTo(e.target.value)}
        >
          {assignedTo !== '' && !members.some(m => m.uid === assignedTo) && (
            <option value={assignedTo} disabled>Former member</option>
          )}
          {members.map(member => (
            <option key={member.uid} value={member.uid}>
              {member.displayName ?? 'User'}
            </option>
          ))}
        </Select>
      )}

      {/* Eisenhower importance — matches ToDosPage's add/edit drawer chip. */}
      <button
        type="button"
        onClick={() => setIsImportant(v => !v)}
        aria-pressed={isImportant}
        className={cn(
          'inline-flex items-center gap-2 min-h-11 px-3 py-2 rounded-btn border text-sm font-medium transition-colors duration-(--duration-fast) ease-(--ease-standard)',
          'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40',
          isImportant
            ? 'bg-warm-100 border-warm-500/40 text-warm-700 dark:bg-warm-500/15 dark:border-warm-500/40 dark:text-warm-300'
            : 'bg-white border-brand-200 text-brand-600 hover:bg-brand-50 dark:bg-brand-700/50 dark:border-brand-600 dark:text-brand-200 dark:hover:bg-brand-700'
        )}
      >
        <Star
          size={18}
          aria-hidden="true"
          className={isImportant ? 'text-warm-500 fill-warm-500' : 'text-brand-300 dark:text-brand-500'}
        />
        Important
      </button>

      {/* Approve CTA */}
      <Button
        variant="success"
        size="lg"
        onClick={handleApprove}
        disabled={!canApprove}
        isLoading={isSubmitting}
        className="w-full py-3"
        leftIcon={<Check size={18} strokeWidth={3} />}
      >
        Add to list
      </Button>

      {/* Secondary delete row */}
      <div className="flex pt-1 border-t border-brand-200 dark:border-brand-700 mt-2">
        <Button
          variant="ghost-danger"
          size="sm"
          className="flex-1 text-xs"
          leftIcon={<Trash2 size={14} />}
          onClick={handleDelete}
          disabled={isSubmitting}
        >
          Discard
        </Button>
      </div>
    </div>
  );
};

export default TodoReviewForm;
