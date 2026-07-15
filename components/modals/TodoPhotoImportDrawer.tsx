import React from 'react';
import toast from 'react-hot-toast';
import { useHouseholdCore, useTodos } from '@/contexts/FirebaseHouseholdContext';
import { getLocalDateString } from '@/utils/dateHelpers';
import { track } from '@/services/analytics';
import Input from '@/components/ui/Input';
import { PhotoImportDrawer } from './PhotoImportDrawer';

interface TodoRowData {
  text: string;
}

interface TodoPhotoImportDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * F-TODO-06: snap a handwritten/whiteboard list into multiple to-dos. Thin
 * caller around the shared {@link PhotoImportDrawer} — parses the photo into task
 * lines and, after review, adds each confirmed line as its own to-do
 * (`source: 'photo'`, due today, assigned to the current user).
 */
export const TodoPhotoImportDrawer: React.FC<TodoPhotoImportDrawerProps> = ({
  isOpen,
  onClose,
}) => {
  const { householdId, currentUser, members } = useHouseholdCore();
  const { addToDo } = useTodos();

  const parse = async (base64Image: string): Promise<TodoRowData[]> => {
    if (!householdId) throw new Error('Household ID not found');
    const { parseTaskList } = await import('@/services/geminiService');
    const result = await parseTaskList(householdId, base64Image);
    track('photo_tasklist_scanned', { count: result.tasks.length });
    return result.tasks
      .map((t) => ({ text: t.text.trim() }))
      .filter((t) => t.text.length > 0);
  };

  const onCommit = async (items: TodoRowData[]): Promise<void> => {
    const assignedTo = currentUser?.uid ?? (members[0]?.uid ?? '');
    const today = getLocalDateString();
    // Each line is an independent single-document write; add them concurrently
    // and surface a partial-success count rather than failing the whole batch.
    const results = await Promise.allSettled(
      items.map((item) =>
        addToDo({
          text: item.text,
          completeByDate: today,
          assignedTo,
          isCompleted: false,
          source: 'photo',
        })
      )
    );
    results.forEach((result) => {
      if (result.status === 'rejected') {
        console.error('Failed to add to-do:', result.reason);
      }
    });
    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    if (succeeded === 0) throw new Error('All to-do writes failed');
    toast.success(`Added ${succeeded} to-do${succeeded === 1 ? '' : 's'}`);
  };

  return (
    <PhotoImportDrawer<TodoRowData>
      isOpen={isOpen}
      onClose={onClose}
      title="Scan a to-do list"
      titleId="todo-photo-import-title"
      hint="Snap a photo of a handwritten note, whiteboard, or chore chart and we'll turn each line into a to-do."
      parse={parse}
      isRowValid={(item) => item.text.trim().length > 0}
      renderRow={(item, patch) => (
        <Input
          type="text"
          value={item.text}
          onChange={(e) => patch({ text: e.target.value })}
          placeholder="Task description"
          aria-label="Task description"
        />
      )}
      onCommit={onCommit}
      commitLabel={(count) => `Add ${count} to-do${count === 1 ? '' : 's'}`}
      emptyResult="No tasks found in that photo. Try a clearer shot."
      getItemLabel={(item) => item.text}
    />
  );
};

export default TodoPhotoImportDrawer;
