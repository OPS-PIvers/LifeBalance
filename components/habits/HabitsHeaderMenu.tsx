import React, { useEffect, useRef, useState } from 'react';
import { MoreVertical, Download, Sparkles, ListOrdered, Settings } from 'lucide-react';

/**
 * HabitsHeaderMenu — collapses the old four-button header
 * (Export / Adjust / Reorder / Manage) into a single overflow menu, per the
 * redesign IA. Grouped-flat surface, hairline divider, warm-amber focus accent
 * for the habits/gamification side. Both themes.
 *
 * The four actions are surfaced as menu items rather than competing top-level
 * buttons, so the page header stays calm and editorial. "Manage" is the primary
 * action and keeps an accent treatment.
 */
export interface HabitsHeaderMenuProps {
  onExport: () => void;
  onAdjust: () => void;
  onReorder: () => void;
  onManage: () => void;
  /** Disable the actions that operate on existing habits (Export/Adjust/Reorder). */
  actionsDisabled?: boolean;
}

interface MenuAction {
  key: string;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  ariaLabel?: string;
  primary?: boolean;
}

const HabitsHeaderMenu: React.FC<HabitsHeaderMenuProps> = ({
  onExport,
  onAdjust,
  onReorder,
  onManage,
  actionsDisabled = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);

  const actions: MenuAction[] = [
    {
      key: 'manage',
      label: 'Manage habits',
      icon: <Settings size={16} />,
      onClick: onManage,
      primary: true,
    },
    {
      key: 'adjust',
      label: 'Smart adjust',
      icon: <Sparkles size={16} />,
      onClick: onAdjust,
      disabled: actionsDisabled,
    },
    {
      key: 'reorder',
      label: 'Smart reorder',
      icon: <ListOrdered size={16} />,
      onClick: onReorder,
      disabled: actionsDisabled,
    },
    {
      key: 'export',
      label: 'Export to CSV',
      icon: <Download size={16} />,
      onClick: onExport,
      disabled: actionsDisabled,
      ariaLabel: 'Export habits to CSV',
    },
  ];

  // Move focus to the first enabled item when the menu opens.
  useEffect(() => {
    if (isOpen && firstItemRef.current) {
      firstItemRef.current.focus();
    }
  }, [isOpen]);

  const close = () => {
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  const runAction = (action: MenuAction) => {
    if (action.disabled) return;
    setIsOpen(false);
    action.onClick();
  };

  const handleMenuKeyDown = (e: React.KeyboardEvent) => {
    const count = actions.length;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setFocusedIndex(prev => (prev + 1) % count);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusedIndex(prev => (prev - 1 + count) % count);
        break;
      case 'Escape':
        e.preventDefault();
        close();
        break;
    }
  };

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setIsOpen(prev => !prev);
          setFocusedIndex(0);
        }}
        className="shrink-0 p-2.5 bg-white dark:bg-brand-800 border border-brand-200 dark:border-brand-700 rounded-card text-brand-500 dark:text-brand-400 hover:text-warm-600 dark:hover:text-warm-300 hover:border-brand-300 dark:hover:border-brand-600 active:scale-95 transition-[transform,color,border-color] duration-(--duration-fast) ease-(--ease-standard) focus:outline-hidden focus-visible:ring-2 focus-visible:ring-warm-500/40 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-brand-900"
        aria-label="Habit actions menu"
        aria-haspopup="menu"
        aria-expanded={isOpen}
      >
        <MoreVertical size={20} />
      </button>

      {isOpen && (
        <>
          {/* Click-away backdrop */}
          <div
            className="fixed inset-0 z-dropdown"
            onClick={close}
            aria-hidden="true"
          />
          <div
            className="absolute top-12 right-0 z-dropdown min-w-[208px] surface-section shadow-raised overflow-hidden py-1 animate-in fade-in zoom-in-95 duration-(--duration-fast)"
            role="menu"
            aria-orientation="vertical"
            aria-label="Habit actions"
            onKeyDown={handleMenuKeyDown}
          >
            {actions.map((action, idx) => (
              <button
                key={action.key}
                ref={idx === 0 ? firstItemRef : undefined}
                type="button"
                role="menuitem"
                tabIndex={-1}
                disabled={action.disabled}
                aria-label={action.ariaLabel}
                onClick={() => runAction(action)}
                className={[
                  'w-full flex items-center gap-3 px-4 py-2.5 text-sm font-semibold text-left transition-colors duration-(--duration-fast) ease-(--ease-standard) focus:outline-hidden disabled:opacity-40 disabled:cursor-not-allowed',
                  action.primary
                    ? 'text-accent-700 dark:text-accent-200'
                    : 'text-brand-700 dark:text-brand-200',
                  focusedIndex === idx && !action.disabled
                    ? 'bg-warm-50 dark:bg-warm-900/20'
                    : 'hover:bg-brand-50 dark:hover:bg-brand-700/40',
                ].join(' ')}
              >
                <span
                  className={
                    action.primary
                      ? 'text-accent-600 dark:text-accent-300'
                      : 'text-brand-400 dark:text-brand-500'
                  }
                  aria-hidden="true"
                >
                  {action.icon}
                </span>
                {action.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default HabitsHeaderMenu;
