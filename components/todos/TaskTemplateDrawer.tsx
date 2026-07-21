import React, { useState } from 'react';
import { useTodos } from '@/contexts/FirebaseHouseholdContext';
import { TaskTemplate } from '@/types/schema';
import { ClipboardList, ChevronDown, Plus, Trash2 } from 'lucide-react';
import { getTemplateTint } from '@/components/todos/todoDisplay';
import { TEMPLATE_ICONS } from '@/data/templateIcons';
import { Drawer } from '@/components/ui/Drawer';
import { Button } from '@/components/ui/Button';
import { SurfaceList, Row } from '@/components/ui/Section';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';
import { showDeleteConfirmation } from '@/utils/toastHelpers';
import toast from 'react-hot-toast';
import { toastIcon } from '@/components/ui/toastIcon';
import { Info } from 'lucide-react';
import { cn } from '@/utils/cn';

const templateIconMap = new Map(TEMPLATE_ICONS.map(i => [i.id, i.icon]));

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
  const { taskTemplates, applyTaskTemplate, deleteTaskTemplate, addTaskTemplate } = useTodos();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newItemsText, setNewItemsText] = useState('');
  const [isSavingNew, setIsSavingNew] = useState(false);

  // Collapse expansions / reset the create form each time the drawer reopens.
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  if (prevIsOpen !== isOpen) {
    setPrevIsOpen(isOpen);
    if (isOpen) {
      setExpandedIds(new Set());
      setIsCreating(false);
      setNewName('');
      setNewItemsText('');
    }
  }

  const toggleExpanded = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

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

  const handleSaveNew = async () => {
    const name = newName.trim();
    const items = newItemsText
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(text => ({ text }));

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
              const isExpanded = expandedIds.has(template.id);
              const isBusy = busyId === template.id;

              return (
                <React.Fragment key={template.id}>
                  <Row className="p-0 items-stretch">
                    <button
                      type="button"
                      onClick={() => handleApply(template)}
                      disabled={busyId !== null}
                      aria-label={`Add tasks from ${template.name}`}
                      className={cn(
                        'flex-1 flex items-center gap-3 pl-4 pr-2 py-3 min-h-11 text-left',
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
                        <span className="block text-xs text-brand-500 dark:text-brand-400">
                          {template.items.length} {template.items.length === 1 ? 'task' : 'tasks'}
                        </span>
                      </span>
                      <span className="ml-auto shrink-0 flex items-center gap-1 text-xs font-medium text-accent-600 dark:text-accent-300">
                        <Plus size={14} />
                        {isBusy ? 'Adding…' : 'Add'}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleExpanded(template.id)}
                      aria-expanded={isExpanded}
                      aria-label={`${isExpanded ? 'Hide' : 'Show'} tasks in ${template.name}`}
                      className={cn(
                        'shrink-0 min-w-11 min-h-11 flex items-center justify-center',
                        'text-brand-400 hover:text-brand-600 dark:text-brand-450 dark:hover:text-brand-200',
                        'hover:bg-brand-50 dark:hover:bg-brand-700/40 transition-colors duration-(--duration-fast) ease-(--ease-standard)',
                        'focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40 focus-visible:ring-inset'
                      )}
                    >
                      <ChevronDown
                        size={16}
                        className={cn(
                          'transition-transform duration-(--duration-fast) ease-(--ease-standard)',
                          !isExpanded && '-rotate-90'
                        )}
                      />
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

                  {isExpanded && (
                    <ul className="hairline-divider bg-brand-50/50 dark:bg-brand-900/20 py-1 animate-in fade-in slide-in-from-top-2 duration-(--duration-fast)">
                      {template.items.length === 0 ? (
                        <li className="px-4 py-2 text-xs text-brand-400 dark:text-brand-450 italic">
                          No tasks in this template
                        </li>
                      ) : template.items.map((item, idx) => (
                        <li
                          key={`${template.id}-${idx}`}
                          className="flex items-center gap-2 px-4 py-1.5 text-sm text-brand-700 dark:text-brand-300"
                        >
                          <span className="truncate">{item.text}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </React.Fragment>
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
