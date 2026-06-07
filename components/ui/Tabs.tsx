import * as React from 'react';
import { cn } from '../../utils/cn';

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

/** Derive stable ids from the shared prefix and a tab's value. */
function useTabIds(tabValue: string, idPrefix: string) {
  // Replace characters that are invalid in HTML id attributes
  const safe = tabValue.replace(/[^a-zA-Z0-9_-]/g, '_');
  const triggerId = `${idPrefix}-tab-${safe}`;
  const panelId = `${idPrefix}-panel-${safe}`;
  return { triggerId, panelId };
}

export const TabsList: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className,
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
    <div
      className={cn(
        'bg-slate-100/80 dark:bg-slate-700/50 p-1.5 rounded-xl flex flex-nowrap gap-1 overflow-x-auto',
        className
      )}
      role="tablist"
      onKeyDown={handleKeyDown}
    >
      {children}
    </div>
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
        'inline-flex flex-none items-center justify-center gap-2 px-3 py-2 text-sm font-semibold tracking-tight rounded-lg transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
        isActive
          ? 'bg-white text-slate-900 shadow-sm ring-1 ring-black/5 dark:bg-slate-800 dark:text-slate-100 dark:ring-white/10'
          : 'text-slate-500 hover:text-slate-700 hover:bg-white/50 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800/50',
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
      className={cn('animate-in fade-in duration-300', className)}
    >
      {children}
    </div>
  );
};
