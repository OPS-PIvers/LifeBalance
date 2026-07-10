import React, { useState } from 'react';
import { MoreVertical, Download, Sparkles, ListOrdered, Settings } from 'lucide-react';
import { Menu, type MenuItem } from '@/components/ui/Menu';

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
  /**
   * Show the "Smart adjust"/"Smart reorder" AI power-tool items. Defaults to
   * `true`; pass `false` when `powerToolsEnabled` is off (Plan 17) so the menu
   * only surfaces Manage/Export.
   */
  showSmartTools?: boolean;
}

const HabitsHeaderMenu: React.FC<HabitsHeaderMenuProps> = ({
  onExport,
  onAdjust,
  onReorder,
  onManage,
  actionsDisabled = false,
  showSmartTools = true,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  const items: MenuItem[] = [
    { key: 'manage', label: 'Manage habits', icon: <Settings size={16} />, onSelect: onManage, tone: 'primary' },
    ...(showSmartTools
      ? [
          { key: 'adjust', label: 'Smart adjust', icon: <Sparkles size={16} />, onSelect: onAdjust, disabled: actionsDisabled },
          { key: 'reorder', label: 'Smart reorder', icon: <ListOrdered size={16} />, onSelect: onReorder, disabled: actionsDisabled },
        ]
      : []),
    {
      key: 'export',
      label: 'Export to CSV',
      icon: <Download size={16} />,
      onSelect: onExport,
      disabled: actionsDisabled,
      ariaLabel: 'Export habits to CSV',
    },
  ];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="shrink-0 p-2.5 bg-white dark:bg-brand-800 border border-brand-200 dark:border-brand-700 rounded-card text-brand-500 dark:text-brand-400 hover:text-warm-600 dark:hover:text-warm-300 hover:border-brand-300 dark:hover:border-brand-600 active:scale-95 transition-[transform,color,border-color] duration-(--duration-fast) ease-(--ease-standard) focus:outline-hidden focus-visible:ring-2 focus-visible:ring-warm-500/40 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-brand-900"
        aria-label="Habit actions menu"
        aria-haspopup="menu"
        aria-expanded={isOpen}
      >
        <MoreVertical size={20} />
      </button>

      <Menu
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        items={items}
        ariaLabel="Habit actions"
        position="top-12 right-0"
        className="min-w-[208px]"
      />
    </div>
  );
};

export default HabitsHeaderMenu;
