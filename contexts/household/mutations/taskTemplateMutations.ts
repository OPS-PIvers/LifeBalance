import {
  collection,
  doc,
  updateDoc,
  arrayUnion,
  writeBatch,
  serverTimestamp,
  type Firestore,
} from 'firebase/firestore';
import toast from 'react-hot-toast';
import { describeError } from '@/utils/errorMessages';
import { TaskTemplate, Household } from '@/types/schema';
import { buildToDosFromTemplate } from '@/utils/taskTemplates';
import { getLocalDateString } from '@/utils/dateHelpers';
import type { User } from 'firebase/auth';

/**
 * F-TODO-03 — Task templates ("Quick Task Lists"). Mirrors the
 * QuickStockList pattern in shoppingMutations.ts: `taskTemplates` is a plain
 * array field on the household document (not a subcollection), so no
 * firestore.rules changes are needed — the household `update` rule has no
 * field whitelist on this array's shape.
 *
 * addTaskTemplate / deleteTaskTemplate — original-style closures captured
 * only `householdId`.
 */
export function makeTaskTemplateMutations(deps: {
  db: Firestore;
  householdId: string | null;
}) {
  const { db, householdId } = deps;

  const addTaskTemplate = async (template: Omit<TaskTemplate, 'id'>) => {
    if (!householdId) {
      throw new Error('Household not selected');
    }
    try {
      const newTemplate: TaskTemplate = { ...template, id: crypto.randomUUID() };
      await updateDoc(doc(db, `households/${householdId}`), {
        taskTemplates: arrayUnion(newTemplate)
      });
      toast.success('Template created');
    } catch (error) {
      console.error('[addTaskTemplate] Failed:', error);
      toast.error(describeError(error, 'create the template'));
      throw error;
    }
  };

  return { addTaskTemplate };
}

/**
 * updateTaskTemplate / deleteTaskTemplate — closures captured `householdId`,
 * `householdSettings` (need the current array to replace/filter it, same as
 * updateQuickStockList / deleteQuickStockList).
 */
export function makeTaskTemplateSettingsMutations(deps: {
  db: Firestore;
  householdId: string | null;
  householdSettings: Household | null;
}) {
  const { db, householdId, householdSettings } = deps;

  const updateTaskTemplate = async (updatedTemplate: TaskTemplate) => {
    if (!householdId || !householdSettings) return;
    try {
      const currentTemplates = householdSettings.taskTemplates || [];
      const newTemplates = currentTemplates.map(t => t.id === updatedTemplate.id ? updatedTemplate : t);
      await updateDoc(doc(db, `households/${householdId}`), {
        taskTemplates: newTemplates
      });
      toast.success('Template updated');
    } catch (error) {
      console.error('[updateTaskTemplate] Failed:', error);
      toast.error(describeError(error, 'update the template'));
    }
  };

  const deleteTaskTemplate = async (id: string) => {
    if (!householdId || !householdSettings) return;
    try {
      const currentTemplates = householdSettings.taskTemplates || [];
      const newTemplates = currentTemplates.filter(t => t.id !== id);
      await updateDoc(doc(db, `households/${householdId}`), {
        taskTemplates: newTemplates
      });
      toast.success('Template deleted');
    } catch (error) {
      console.error('[deleteTaskTemplate] Failed:', error);
      toast.error(describeError(error, 'delete the template'));
    }
  };

  return { updateTaskTemplate, deleteTaskTemplate };
}

/**
 * applyTaskTemplate — one-tap creation of a bundle of to-dos from a saved
 * template. Every created to-do commits in a SINGLE writeBatch (atomicity —
 * see CLAUDE.md's habit/todo batch-write conventions) so a template never
 * partially applies.
 */
export function makeApplyTaskTemplate(deps: {
  db: Firestore;
  householdId: string | null;
  user: User | null;
}) {
  const { db, householdId, user } = deps;

  const applyTaskTemplate = async (template: TaskTemplate): Promise<number> => {
    if (!householdId || !user) {
      throw new Error('User not authenticated or household not selected');
    }
    try {
      const today = getLocalDateString();
      const todosToCreate = buildToDosFromTemplate(template, today, user.uid);
      if (todosToCreate.length === 0) return 0;

      const batch = writeBatch(db);
      const todosCol = collection(db, `households/${householdId}/todos`);
      todosToCreate.forEach(todo => {
        const ref = doc(todosCol);
        batch.set(ref, {
          ...todo,
          createdAt: serverTimestamp(),
          createdBy: user.uid,
        });
      });
      await batch.commit();
      return todosToCreate.length;
    } catch (error) {
      console.error('[applyTaskTemplate] Failed:', error);
      throw error;
    }
  };

  return { applyTaskTemplate };
}
