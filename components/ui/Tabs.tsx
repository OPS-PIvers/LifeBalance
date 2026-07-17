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

export const TabsList: React.FC<
  {
    children: React.ReactNode;
    className?: string;
    /**
     * `md` (default) reserves the full 44px (`min-h-11`) primary-nav touch
     * target. `sm` shrinks triggers to `min-h-9`/tighter padding for secondary
     * in-page tab strips (e.g. a day picker) — reserve `md` for primary
     * bottom-nav-adjacent navigation.
     */
    size?: 'md' | 'sm';
  } & Omit<React.ComponentPropsWithoutRef<'div'>, 'role' | 'onKeyDown'>
> = ({
  children,
  className,
  size = 'md',
  ...rest
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

  // Overflow affordance: on narrow screens a long tab strip scrolls, but with
  // no scrollbar (`no-scrollbar`) nothing hinted that more tabs exist offscreen
  // (e.g. Money's 7 tabs cut off after "Buckets"). Fade the clipped edge(s).
  const scrollerRef = React.useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = React.useState({ left: false, right: false });
  const updateOverflow = React.useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const left = el.scrollLeft > 2;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setOverflow(prev => (prev.left === left && prev.right === right ? prev : { left, right }));
  }, []);
  React.useEffect(() => {
    updateOverflow();
    const el = scrollerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(updateOverflow);
    ro.observe(el);
    return () => ro.disconnect();
  }, [updateOverflow]);

  const fadeBase =
    'pointer-events-none absolute inset-y-0 w-8 rounded-xl from-brand-100 dark:from-brand-800 to-transparent transition-opacity duration-(--duration-fast) ease-(--ease-standard)';

  return (
    <TabsSizeContext.Provider value={size}>
      {/* Caller className lands on the wrapper (layout: margins, inline-flex)
          so the edge fades always hug the pill itself. */}
      <div className={cn('relative', className)}>
        <div
          ref={scrollerRef}
          onScroll={updateOverflow}
          className="bg-brand-100 dark:bg-brand-800 p-1 rounded-xl flex flex-nowrap gap-1 overflow-x-auto no-scrollbar border border-brand-200 dark:border-brand-700"
          role="tablist"
          onKeyDown={handleKeyDown}
          {...rest}
        >
          {children}
        </div>
        <div aria-hidden="true" className={cn(fadeBase, 'left-0 bg-gradient-to-r', overflow.left ? 'opacity-100' : 'opacity-0')} />
        <div aria-hidden="true" className={cn(fadeBase, 'right-0 bg-gradient-to-l', overflow.right ? 'opacity-100' : 'opacity-0')} />
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
        'relative inline-flex flex-none items-center justify-center gap-2 text-sm font-semibold tracking-tight rounded-sm transition-all duration-(--duration-fast) ease-(--ease-standard) focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40',
        // sm renders a 36px-tall trigger — below the 44px touch-target floor —
        // so it carries Button's invisible before: hit-area extender (vertical
        // only: adjacent triggers in the strip would overlap horizontally).
        // -inset-y-1.5 (not -1): the active trigger gains a 1px border, which
        // shrinks the padding box the pseudo anchors to — 6px each side keeps
        // both states ≥44px.
        size === 'sm'
          ? "min-h-9 px-2.5 py-1.5 before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-['']"
          : 'min-h-11 px-3 py-2',
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
