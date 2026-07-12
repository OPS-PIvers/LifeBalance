import React from 'react';
import { Check, Trash2, Edit2, AlertCircle, Clock, User, Copy, MoreVertical, Calendar, Star, CheckSquare } from 'lucide-react';
import { format, isToday, isTomorrow, parseISO, isBefore, startOfToday } from 'date-fns';
import { ToDo, HouseholdMember } from '@/types/schema';
import { DEFAULT_TODO_POINTS } from '@/utils/todoPoints';
import toast from 'react-hot-toast';
import { haptic } from '@/utils/haptics';
import { HapticCheck } from '@/components/ui/HapticCheck';
import { SwipeActionRow } from '@/components/ui/SwipeActionRow';
import { showDeleteConfirmation } from '@/utils/toastHelpers';
import { Button } from '@/components/ui/Button';
import { cn } from '@/utils/cn';
import { type SectionColor, dateColorMap } from './todoDisplay';

// Moved verbatim from pages/ToDosPage.tsx (Plan 27) — extracted because both
// the list arrangement (still in ToDosPage) and the Eisenhower matrix view
// (components/todos/EisenhowerMatrixView.tsx) render rows via `Section`,
// which renders `TodoRow`.

export interface TodoRowProps {
  item: ToDo;
  color: SectionColor;
  assignee: HouseholdMember | undefined;
  isSelected: boolean;
  isSelectionMode: boolean;
  onComplete: (id: string) => void;
  onEdit: (todo: ToDo) => void;
  onDelete: (id: string) => void;
  onDuplicate: (todo: ToDo) => void;
  onMoveToTomorrow: (todo: ToDo) => void;
  onToggleImportant: (todo: ToDo) => void;
  onMore: (todo: ToDo) => void;
  onToggleSelection: (id: string) => void;
}

// Memoized row for a single active to-do.
// Uses a field-by-field comparator so toggling selection in one row does not
// re-render sibling rows that haven't changed their selected state.
export const TodoRow = React.memo(function TodoRow({
  item,
  color,
  assignee,
  isSelected,
  isSelectionMode,
  onComplete,
  onEdit,
  onDelete,
  onDuplicate,
  onMoveToTomorrow,
  onToggleImportant,
  onMore,
  onToggleSelection,
}: TodoRowProps) {
  // Parse the due date once per row render to avoid repeated parseISO calls
  const dueDate = parseISO(item.completeByDate);
  const isOverdue = isBefore(dueDate, startOfToday());

  // Shared by the checkbox control and the right-swipe action.
  const handleComplete = async () => {
    try {
      await onComplete(item.id);
      toast.success('To-Do completed! 🎉');
    } catch (error) {
      console.error('Failed to complete task:', error);
      toast.error('Failed to complete to-do');
    }
  };

  const cardInner = (
    <div
      onClick={() => isSelectionMode && onToggleSelection(item.id)}
      {...(isSelectionMode ? {
        role: 'button' as const,
        tabIndex: 0,
        'aria-pressed': isSelected,
        'aria-label': `${isSelected ? 'Deselect' : 'Select'} task: ${item.text}`,
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggleSelection(item.id);
          }
        }
      } : {})}
      className={cn(
        'hairline-divider p-4 transition-colors duration-(--duration-fast) ease-(--ease-standard)',
        isSelectionMode
          ? isSelected
            ? 'cursor-pointer bg-accent-50 dark:bg-accent-900/30'
            : 'cursor-pointer bg-white dark:bg-brand-800 hover:bg-brand-50 dark:hover:bg-brand-700/40'
          : 'bg-white dark:bg-brand-800'
      )}
    >
      <div className="flex items-start gap-3">
        {/* Complete Checkbox or Selection Box */}
        {isSelectionMode ? (
          <div className={`mt-0.5 w-6 h-6 flex items-center justify-center shrink-0 transition-colors ${isSelected ? 'text-accent-600 dark:text-accent-300' : 'text-brand-300 dark:text-brand-500'}`}>
            {isSelected ? <CheckSquare aria-hidden="true" size={24} /> : <div className="w-5 h-5 border-2 border-current rounded-sm" />}
          </div>
        ) : (
          <HapticCheck
            checked={false}
            onCheckedChange={handleComplete}
            onClick={(e) => e.stopPropagation()}
            className="mt-0.5 p-2.5 -m-2.5 shrink-0"
            aria-label={`Complete task: ${item.text}`}
          >
            <span className="w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors border-brand-300 group-hover:border-accent-500 group-hover:bg-accent-50 group-active:bg-accent-100 dark:border-brand-600 dark:group-hover:border-accent-400 dark:group-hover:bg-accent-900/30">
              <Check size={14} className="text-transparent group-hover:text-current group-active:text-current group-has-[:focus-visible]:text-current transition-colors" />
            </span>
          </HapticCheck>
        )}

        <div className="flex-1 min-w-0">
          <p className={`font-medium leading-snug ${isSelected ? 'text-accent-800 dark:text-accent-200' : 'text-brand-900 dark:text-brand-50'}`}>{item.text}</p>

          <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs">
            {/* Single primary status signal: urgency-colored text, not a bordered pill. */}
            {isOverdue ? (
              <span className="flex items-center gap-1 font-semibold text-money-neg dark:text-money-negDark">
                <AlertCircle size={11} />
                Overdue ({format(dueDate, 'MMM d')})
              </span>
            ) : (
              <span className={`flex items-center gap-1 font-semibold ${dateColorMap[color]}`}>
                <Clock size={11} />
                {isToday(dueDate) ? 'Today' :
                 isTomorrow(dueDate) ? 'Tomorrow' :
                 format(dueDate, 'MMM d')}
              </span>
            )}

            {assignee && (
              <span className="flex items-center gap-1 text-brand-500 dark:text-brand-400">
                {assignee.photoURL ? (
                  <img
                    src={assignee.photoURL}
                    className="w-4 h-4 rounded-full"
                    alt={assignee.displayName ?? 'Task assignee'}
                  />
                ) : (
                  <User size={10} />
                )}
                {assignee.displayName?.split(' ')[0] ?? 'User'}
              </span>
            )}

            {/* Plan 080c-5: points-on-completion badge — kid chores only. Dormant for
                normal households: only shown when the assignee is a managed kid. This
                is the one signal that keeps pill chrome — it's a distinct bonus, not
                metadata, so it should still pop against the plain-text date/assignee. */}
            {assignee?.isManaged === true && (
              <span className="flex items-center gap-1 font-bold px-2 py-1 rounded-sm bg-warm-100 text-warm-700 dark:bg-warm-500/15 dark:text-warm-300">
                +{item.points ?? DEFAULT_TODO_POINTS} pts
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        {!isSelectionMode && (
          <>
            {/* Importance star — always visible at every width (not hover-
                gated): one-tap family triage is the core Eisenhower workflow. */}
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
            {/* Desktop Actions */}
            <div className="hidden sm:flex items-center gap-1 pl-2">
              <Button
                variant="ghost-brand"
                size="icon"
                onClick={(e) => { e.stopPropagation(); onMoveToTomorrow(item); }}
                aria-label="Move to Tomorrow"
                title="Move to Tomorrow"
              >
                <Calendar size={16} />
              </Button>
              <Button
                variant="ghost-brand"
                size="icon"
                onClick={(e) => { e.stopPropagation(); onDuplicate(item); }}
                aria-label="Duplicate task"
                title="Duplicate"
              >
                <Copy size={16} />
              </Button>
              <Button
                variant="ghost-brand"
                size="icon"
                onClick={(e) => { e.stopPropagation(); onEdit(item); }}
                aria-label="Edit task"
              >
                <Edit2 size={16} />
              </Button>
              <Button
                variant="ghost-brand"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  showDeleteConfirmation(async () => {
                    haptic('medium');
                    await onDelete(item.id);
                    toast.success('Task deleted');
                  });
                }}
                className="hover:text-money-neg active:text-money-neg active:bg-money-bgNeg dark:hover:text-money-negDark dark:active:bg-money-neg/15"
                aria-label="Delete task"
              >
                <Trash2 size={16} />
              </Button>
            </div>
            {/* Mobile Actions */}
            <div className="flex sm:hidden pl-2">
              <Button
                variant="ghost-brand"
                size="icon"
                onClick={(e) => { e.stopPropagation(); onMore(item); }}
                aria-label={`More options for: ${item.text}`}
              >
                <MoreVertical size={20} />
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );

  // In selection mode we keep tap-to-select intact and skip the swipe gesture.
  if (isSelectionMode) {
    return <>{cardInner}</>;
  }

  // Gmail-style swipe: right = complete, left = delete (with confirmation).
  // Partial swipes stick open to a tappable button; SwipeActionRow handles
  // thresholds, reveal, haptics, and the reduced-motion fallback (the row's
  // own checkbox and delete buttons remain the accessible path).
  return (
    <SwipeActionRow
      startAction={{
        icon: Check,
        label: 'Complete',
        tone: 'positive',
        hapticPattern: 'success',
        onAction: handleComplete,
      }}
      endAction={{
        icon: Trash2,
        label: 'Delete',
        tone: 'destructive',
        hapticPattern: 'medium',
        onAction: () => {
          showDeleteConfirmation(async () => {
            await onDelete(item.id);
            toast.success('Task deleted');
          });
        },
      }}
    >
      {cardInner}
    </SwipeActionRow>
  );
});
