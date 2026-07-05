import * as React from 'react';
import { cn } from '@/utils/cn';

interface TabsProps {
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  children: React.ReactNode;
  className?: string;
}

interface TabsContextValue {
  value: string;
  onValueChange: (value: string) => void;
  idPrefix: string;
  /** Ordered list of registered tab values, used for arrow-key navigation. */
  tabValues: string[];
  registerTab: (value: string) => void;
  unregisterTab: (value: string) => void;
}

const TabsContext = React.createContext<TabsContextValue | null>(null);

// Separate from TabsContext (which is scoped to the whole Tabs root) because
// size is a per-TabsList concern — a page could in principle render more than
// one TabsList under a single Tabs root. Defaults to 'md' when no TabsList
// ancestor is present (shouldn't happen in practice, but keeps TabsTrigger safe).
const TabsSizeContext = React.createContext<'md' | 'sm'>('md');

// Tabs: a routed/tabpanel control (role=tablist/tab/tabpanel + arrow-key roving
// focus + animated TabsContent). Shares the pill-in-trough track + white active
// chrome with SegmentedControl — reach for SegmentedControl instead for an inline
// value toggle that drives no panel.
export const Tabs: React.FC<TabsProps> = ({
  defaultValue,
  value,
  onValueChange,
  children,
  className,
}) => {
  const [internalValue, setInternalValue] = React.useState(defaultValue || '');
  const idPrefix = React.useId();
  const [tabValues, setTabValues] = React.useState<string[]>([]);

  const isControlled = value !== undefined;
  const currentValue = isControlled ? value : internalValue;

  const handleValueChange = (newValue: string) => {
    if (!isControlled) {
      setInternalValue(newValue);
    }
    onValueChange?.(newValue);
  };

  const registerTab = React.useCallback((tabValue: string) => {
    setTabValues((prev) => (prev.includes(tabValue) ? prev : [...prev, tabValue]));
  }, []);

  const unregisterTab = React.useCallback((tabValue: string) => {
    setTabValues((prev) => prev.filter((v) => v !== tabValue));
  }, []);

  return (
    <TabsContext.Provider
      value={{ value: currentValue, onValueChange: handleValueChange, idPrefix, tabValues, registerTab, unregisterTab }}
    >
      <div className={cn('w-full', className)}>{children}</div>
    </TabsContext.Provider>
  );
};

TabsContext.displayName = 'TabsContext';

/** Derive stable ids from the shared prefix and a tab's value. */
function useTabIds(tabValue: string, idPrefix: string) {
  // Replace characters that are invalid in HTML id attributes
  const safe = tabValue.replace(/[^a-zA-Z0-9_-]/g, '_');
  const triggerId = `${idPrefix}-tab-${safe}`;
  const panelId = `${idPrefix}-panel-${safe}`;
  return { triggerId, panelId };
}

export const TabsList: React.FC<{
  children: React.ReactNode;
  className?: string;
  /**
   * `md` (default) reserves the full 44px (`min-h-11`) primary-nav touch
   * target. `sm` shrinks triggers to `min-h-9`/tighter padding for secondary
   * in-page tab strips (e.g. a day picker) — reserve `md` for primary
   * bottom-nav-adjacent navigation.
   */
  size?: 'md' | 'sm';
}> = ({
  children,
  className,
  size = 'md',
}) => {
  const context = React.useContext(TabsContext);
  if (!context) throw new Error('TabsList must be used within Tabs');

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const { tabValues, value, onValueChange } = context;
    const currentIndex = tabValues.indexOf(value);
    if (currentIndex === -1) return;

    let nextIndex: number | null = null;

    if (e.key === 'ArrowRight') {
      nextIndex = (currentIndex + 1) % tabValues.length;
    } else if (e.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + tabValues.length) % tabValues.length;
    } else if (e.key === 'Home') {
      nextIndex = 0;
    } else if (e.key === 'End') {
      nextIndex = tabValues.length - 1;
    }

    if (nextIndex !== null) {
      e.preventDefault();
      const nextValue = tabValues[nextIndex];
      if (nextValue === undefined) return;
      onValueChange(nextValue);
      // Move DOM focus to the newly-selected trigger button
      const listEl = e.currentTarget;
      const nextButton = listEl.querySelector<HTMLButtonElement>(
        `[data-tabs-value="${CSS.escape(nextValue)}"]`
      );
      nextButton?.focus();
    }
  };

  return (
    <TabsSizeContext.Provider value={size}>
      <div
        className={cn(
          'bg-brand-100 dark:bg-brand-800 p-1 rounded-xl flex flex-nowrap gap-1 overflow-x-auto no-scrollbar border border-brand-200 dark:border-brand-700',
          className
        )}
        role="tablist"
        onKeyDown={handleKeyDown}
      >
        {children}
      </div>
    </TabsSizeContext.Provider>
  );
};

export const TabsTrigger: React.FC<{
  value: string;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
}> = ({ value, children, className, disabled }) => {
  const context = React.useContext(TabsContext);
  if (!context) throw new Error('TabsTrigger must be used within Tabs');
  const size = React.useContext(TabsSizeContext);

  const { registerTab, unregisterTab, idPrefix } = context;
  const { triggerId, panelId } = useTabIds(value, idPrefix);

  React.useEffect(() => {
    registerTab(value);
    return () => unregisterTab(value);
  }, [value, registerTab, unregisterTab]);

  const isActive = context.value === value;

  return (
    <button
      id={triggerId}
      role="tab"
      aria-selected={isActive}
      aria-controls={panelId}
      tabIndex={isActive ? 0 : -1}
      data-tabs-value={value}
      onClick={() => !disabled && context.onValueChange(value)}
      disabled={disabled}
      className={cn(
        'inline-flex flex-none items-center justify-center gap-2 text-sm font-semibold tracking-tight rounded-sm transition-all duration-(--duration-fast) ease-(--ease-standard) focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40',
        size === 'sm' ? 'min-h-9 px-2.5 py-1.5' : 'min-h-11 px-3 py-2',
        isActive
          ? 'bg-white text-accent-700 border border-brand-200 dark:bg-brand-700 dark:text-accent-200 dark:border-brand-600'
          : 'text-brand-500 hover:text-brand-700 hover:bg-white/60 dark:text-brand-400 dark:hover:text-brand-200 dark:hover:bg-brand-700/50',
        disabled && 'opacity-50 cursor-not-allowed',
        className
      )}
    >
      {children}
    </button>
  );
};

export const TabsContent: React.FC<{
  value: string;
  children: React.ReactNode;
  className?: string;
}> = ({ value, children, className }) => {
  const context = React.useContext(TabsContext);
  if (!context) throw new Error('TabsContent must be used within Tabs');

  const { panelId, triggerId } = useTabIds(value, context.idPrefix);

  if (context.value !== value) return null;

  return (
    <div
      id={panelId}
      role="tabpanel"
      aria-labelledby={triggerId}
      className={cn('animate-in fade-in duration-(--duration-base)', className)}
    >
      {children}
    </div>
  );
};
