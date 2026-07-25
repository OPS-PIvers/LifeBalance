import React, { useState } from 'react';
import { useTodos } from '@/contexts/FirebaseHouseholdContext';
import { TaskTemplate } from '@/types/schema';
import { ClipboardList, Plus, Trash2, Loader2 } from 'lucide-react';
import { getTemplateTint } from '@/components/todos/todoDisplay';
import { TEMPLATE_ICONS } from '@/data/templateIcons';
import { Drawer } from '@/components/ui/Drawer';
import { Button } from '@/components/ui/Button';
import { SurfaceList, Row } from '@/components/ui/Section';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';
import { CategoryChipPicker } from '@/components/ui/CategoryChipPicker';
import { showDeleteConfirmation } from '@/utils/toastHelpers';
import toast from 'react-hot-toast';
import { toastIcon } from '@/components/ui/toastIcon';
import { Info } from 'lucide-react';
import { cn } from '@/utils/cn';
import { getTodoCategoryColor } from '@/utils/todoCategoryColor';

const templateIconMap = new Map(TEMPLATE_ICONS.map(i => [i.id, i.icon]));

/**
 * F-TODO-16 — the category a template hands to the to-dos it spawns, when its
 * items agree on one. Items carry the category individually (TaskTemplateItem
 * .category) so a future per-item editor can diverge them, but this drawer
 * authors one category per template (see the create form), so the row can show
 * a single chip. Returns undefined for a template with no/mixed categories.
 */
const sharedTemplateCategory = (template: TaskTemplate): string | undefined => {
  const first = template.items[0]?.category?.trim();
  if (!first) return undefined;
  const allMatch = template.items.every(
    item => (item.category ?? '').trim().toLowerCase() === first.toLowerCase()
  );
  return allMatch ? first : undefined;
};

interface TaskTemplateDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * F-TODO-03 — Task templates ("Quick Task Lists"). Mirrors QuickRestockDrawer's
 * one-tap-apply bottom sheet: tapping a template row creates a to-do for every
 * one of its items (see applyTaskTemplate, a single writeBatch). A lightweight
 * inline form (toggled by "New template") lets the household define a template
 * from a name + newline-separated task list — no separate settings modal, kept
 * in scope for this size-medium feature.
 */
export const TaskTemplateDrawer: React.FC<TaskTemplateDrawerProps> = ({ isOpen, onClose }) => {
  const {
    taskTemplates,
    applyTaskTemplate,
    deleteTaskTemplate,
    addTaskTemplate,
    todoCategories,
    updateTodoCategories,
  } = useTodos();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newItemsText, setNewItemsText] = useState('');
  const [newCategory, setNewCategory] = useState<string | undefined>(undefined);
  const [isSavingNew, setIsSavingNew] = useState(false);

  // Reset the create form each time the drawer reopens.
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  if (prevIsOpen !== isOpen) {
    setPrevIsOpen(isOpen);
    if (isOpen) {
      setIsCreating(false);
      setNewName('');
      setNewItemsText('');
      setNewCategory(undefined);
    }
  }

  const handleApply = async (template: TaskTemplate) => {
    if (busyId) return;
    setBusyId(template.id);
    try {
      const count = await applyTaskTemplate(template);
      if (count > 0) {
        toast.success(`Added ${count} ${count === 1 ? 'task' : 'tasks'} from ${template.name}`);
      } else {
        toast('Template has no tasks to add', { icon: toastIcon(Info) });
      }
    } catch {
      toast.error('Failed to add tasks');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = (template: TaskTemplate) => {
    showDeleteConfirmation(() => deleteTaskTemplate(template.id), template.name);
  };

  const handleAddCategory = async (category: string) => {
    await updateTodoCategories([...todoCategories, category]);
  };

  const handleSaveNew = async () => {
    const name = newName.trim();
    // F-TODO-16 — one category for the whole template, stamped onto every item.
    // Absent (never '') is the canonical "Uncategorized" value on the spawned
    // to-dos, so the field is only written when a category was picked.
    const category = newCategory?.trim();
    const items = newItemsText
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(text => ({ text, ...(category ? { category } : {}) }));

    if (!name || items.length === 0) {
      toast.error('Give the template a name and at least one task');
      return;
    }

    setIsSavingNew(true);
    try {
      await addTaskTemplate({ name, items });
      setIsCreating(false);
      setNewName('');
      setNewItemsText('');
      setNewCategory(undefined);
    } catch {
      // Error is already handled and toasted by addTaskTemplate
    } finally {
      setIsSavingNew(false);
    }
  };

  return (
    <Drawer isOpen={isOpen} onClose={onClose} title="Task templates">
      <div className="space-y-2">
        <p className="text-xs text-brand-400 dark:text-brand-450 px-1 pb-1">
          Tap a template to add all of its tasks for today, e.g. &quot;Trash day&quot; or &quot;Guest prep&quot;.
        </p>

        {taskTemplates.length === 0 && !isCreating && (
          <p className="text-sm text-brand-400 dark:text-brand-450 px-1 py-4 text-center">
            No task templates yet.
          </p>
        )}

        {taskTemplates.length > 0 && (
          <SurfaceList>
            {taskTemplates.map(template => {
              const tint = getTemplateTint(template.color);
              const TemplateIcon = (template.icon && templateIconMap.get(template.icon)) || ClipboardList;
              const isBusy = busyId === template.id;
              const itemPreview =
                template.items.length === 0
                  ? 'No tasks yet'
                  : `${template.items.length} ${template.items.length === 1 ? 'task' : 'tasks'}: ${template.items
                      .map(item => item.text)
                      .join(', ')}`;
              const category = sharedTemplateCategory(template);
              const categoryColor = getTodoCategoryColor(category);

              return (
                // Bare hairline/clip wrapper for the two-button compound row below
                // (primary Add action + Delete) — not the normal single-action Row
                // pattern, so padding/alignment are reset here instead of relied on.
                <Row key={template.id} className="p-0 items-stretch">
                  <button
                    type="button"
                    onClick={() => handleApply(template)}
                    disabled={busyId !== null}
                    aria-label={`Add tasks from ${template.name}`}
                    className={cn(
                      'flex-1 flex items-center gap-3 pl-4 pr-2 py-3 min-h-11 text-left min-w-0',
                      'hover:bg-brand-50 dark:hover:bg-brand-700/40 active:bg-brand-100 dark:active:bg-brand-700/50',
                      'transition-colors duration-(--duration-fast) ease-(--ease-standard)',
                      'focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40 focus-visible:ring-inset',
                      'disabled:opacity-60 disabled:pointer-events-none'
                    )}
                  >
                    <span
                      className={cn(
                        'shrink-0 w-9 h-9 rounded-full border flex items-center justify-center',
                        tint.bg,
                        tint.text,
                        tint.border
                      )}
                    >
                      <TemplateIcon size={16} />
                    </span>
                    <span className="min-w-0">
                      <span className="block font-semibold tracking-tight text-sm text-brand-900 dark:text-brand-50 truncate">
                        {template.name}
                      </span>
                      <span className="block text-xs text-brand-500 dark:text-brand-400 truncate">
                        {category && (
                          <span
                            // Not cn(): tailwind-merge reads the custom
                            // `text-xxs` token as a text-COLOR utility, sees a
                            // conflict with `text-*-800` and silently drops it,
                            // so the chip would render at the default size.
                            className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-xxs mr-1.5 align-middle ${categoryColor.bg} ${categoryColor.text} ${categoryColor.border}`}
                          >
                            {category}
                          </span>
                        )}
                        {itemPreview}
                      </span>
                    </span>
                    <span className="ml-auto shrink-0 flex items-center gap-1 text-xs font-medium text-accent-600 dark:text-accent-300">
                      {isBusy ? (
                        <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                      ) : (
                        <Plus size={14} />
                      )}
                      {isBusy ? 'Adding…' : 'Add'}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(template)}
                    aria-label={`Delete ${template.name} template`}
                    className={cn(
                      'shrink-0 min-w-11 min-h-11 flex items-center justify-center',
                      'text-brand-400 hover:text-money-neg dark:text-brand-450 dark:hover:text-money-negDark',
                      'hover:bg-brand-50 dark:hover:bg-brand-700/40 transition-colors duration-(--duration-fast) ease-(--ease-standard)',
                      'focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40 focus-visible:ring-inset'
                    )}
                  >
                    <Trash2 size={16} />
                  </button>
                </Row>
              );
            })}
          </SurfaceList>
        )}

        {isCreating ? (
          <div className="surface-section p-3 space-y-3">
            <Input
              label="Template name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Trash day"
              maxLength={50}
              autoFocus
            />
            <Textarea
              label="Tasks (one per line)"
              value={newItemsText}
              onChange={(e) => setNewItemsText(e.target.value)}
              placeholder={'Take out trash\nBring in bins'}
              rows={3}
            />
            {/* F-TODO-16 — ONE picker for the whole template rather than a chip
                row per line: items are authored here as free-text lines, so a
                per-item control would need a per-item editor and would dwarf
                the three-field form. Every spawned to-do inherits this. */}
            <CategoryChipPicker
              label="Category (optional)"
              categories={todoCategories}
              value={newCategory}
              onChange={setNewCategory}
              onAddCategory={handleAddCategory}
              allowClear
              disabled={isSavingNew}
            />
            <div className="flex items-center gap-2 justify-end">
              <Button variant="secondary" size="sm" onClick={() => setIsCreating(false)} disabled={isSavingNew}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleSaveNew} isLoading={isSavingNew}>
                Save template
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="dashed"
            onClick={() => setIsCreating(true)}
            leftIcon={<Plus size={16} />}
            className="w-full min-h-11"
          >
            New template
          </Button>
        )}
      </div>
    </Drawer>
  );
};
