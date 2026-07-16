import React, { useMemo, useState } from 'react';
import {
  WeeklyPlan,
  WeeklyPlanMeal,
  WeeklyPlanGroceryItem,
} from '@/types/weeklyPlan';
import {
  buildSchedule,
  fmtClock,
  fmtDur,
  parseHM,
  EFFORT_LABEL,
  ScheduledStep,
} from '@/utils/weeklyPlanSchedule';
import {
  subtotal,
  itemPrice,
  groupItemsByStore,
} from '@/utils/weeklyPlanMapper';
import { sumMoney } from '@/utils/money';
import { Button } from '@/components/ui/Button';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import {
  CalendarDays, ShoppingCart, ChevronRight, ChevronLeft, Clock, Check,
  ArrowLeft, ArrowRight, Box, Timer, Hourglass, Baby, ChefHat, X,
} from 'lucide-react';
import clsx from 'clsx';

/**
 * Renders a WeeklyPlan as a "cook in order" guide, mirroring the weekly-meals
 * web app: a Week overview, a per-meal Recipe view with a serve-time scheduler
 * that back-calculates each step's clock time, hand-off tags and leftovers, a
 * store-grouped Shopping list with running subtotals, and a focused Cook Mode.
 *
 * Presentational only — it takes a plan and tracks lightweight view state
 * (selected meal, serve-time overrides, checked items) locally.
 */

const SEC_ORDER = ['meat', 'produce', 'dairy', 'frozen', 'pantry'];

type GuideView = 'week' | 'shopping';

const mealKey = (meal: WeeklyPlanMeal, index: number): string => meal.id || `m${index}`;

const effortLabel = (effort?: string): string =>
  effort ? EFFORT_LABEL[effort.toLowerCase()] || `${effort} effort` : '';

interface MealGuideProps {
  plan: WeeklyPlan;
  /** Hide the internal masthead (e.g. when shown inside a modal that has its own header). */
  hideMasthead?: boolean;
}

export const MealGuide: React.FC<MealGuideProps> = ({ plan, hideMasthead }) => {
  const [view, setView] = useState<GuideView>('week');
  const [recipeIndex, setRecipeIndex] = useState<number | null>(null);
  const [serveOverrides, setServeOverrides] = useState<Record<string, string>>({});
  const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set());
  const [cookMode, setCookMode] = useState(false);

  const meals = plan.meals ?? [];
  const selectedMeal = recipeIndex !== null ? meals[recipeIndex] : null;

  const schedule = useMemo(() => {
    if (!selectedMeal || recipeIndex === null) return null;
    const key = mealKey(selectedMeal, recipeIndex);
    return buildSchedule(selectedMeal, serveOverrides[key]);
  }, [selectedMeal, recipeIndex, serveOverrides]);

  const openRecipe = (i: number) => { setRecipeIndex(i); setCookMode(false); };
  const closeRecipe = () => { setRecipeIndex(null); setCookMode(false); };

  const toggleItem = (id: string) => {
    setCheckedItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // --- Cook mode (full-screen, one step at a time) -------------------------
  if (cookMode && selectedMeal && schedule) {
    return (
      <CookMode
        meal={selectedMeal}
        steps={schedule.steps}
        onClose={() => setCookMode(false)}
      />
    );
  }

  // --- Recipe view ---------------------------------------------------------
  if (selectedMeal && recipeIndex !== null && schedule) {
    const key = mealKey(selectedMeal, recipeIndex);
    // Show the same serve time the schedule was actually computed from, so the
    // <input type="time"> never goes blank on a malformed defaultServe.
    const serveValue =
      (parseHM(serveOverrides[key]) !== null && serveOverrides[key]) ||
      (parseHM(selectedMeal.defaultServe) !== null && selectedMeal.defaultServe) ||
      '18:00';
    return (
      <div className="pb-24">
        <RecipeView
          meal={selectedMeal}
          schedule={schedule}
          serveValue={serveValue}
          onServeChange={(v) => setServeOverrides(prev => ({ ...prev, [key]: v }))}
          onBack={closeRecipe}
          onStartCook={() => setCookMode(true)}
        />
      </div>
    );
  }

  // --- Week / Shopping tabs ------------------------------------------------
  return (
    <div className="pb-24">
      {!hideMasthead && (
        <header className="px-1 pb-4">
          {plan.weekLabel && (
            <div className="text-xxs font-bold uppercase tracking-widest text-brand-600">{plan.weekLabel}</div>
          )}
          <h2 className="text-2xl font-bold text-brand-900 dark:text-brand-100 tracking-tight mt-1">This Week</h2>
          {plan.subtitle && <p className="text-sm text-brand-500 dark:text-brand-400 mt-1 leading-relaxed">{plan.subtitle}</p>}
        </header>
      )}

      {view === 'week' ? (
        <div className="space-y-3">
          <div className="text-xxs font-bold uppercase tracking-widest text-brand-400 dark:text-brand-450 px-1">Cook in order</div>
          {meals.map((meal, i) => {
            const sched = buildSchedule(meal, serveOverrides[mealKey(meal, i)]);
            return (
              <button
                key={mealKey(meal, i)}
                onClick={() => openRecipe(i)}
                className="w-full text-left flex items-start gap-3 p-4 rounded-2xl bg-white border border-brand-200 hover:border-brand-300 transition-colors duration-(--duration-fast) ease-(--ease-standard) dark:bg-brand-800 dark:border-brand-700 dark:hover:border-brand-600"
              >
                <span className="font-display text-2xl font-bold text-brand-600 dark:text-brand-300 leading-none w-7 shrink-0 tabular-nums">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  {/* Scan-and-pick essentials only — name (+ cuisine inline), total
                      duration, effort, and active minutes. The blurb and
                      uses/saves hand-off tags are shown in the tap-through
                      RecipeView instead of being duplicated here. */}
                  <div className="font-bold text-brand-900 dark:text-brand-100 tracking-tight leading-snug text-balance">
                    {meal.cuisine && (
                      <span className="text-xxs font-bold uppercase tracking-wide text-brand-400 dark:text-brand-450">{meal.cuisine} · </span>
                    )}
                    {meal.name}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-xxs font-semibold text-brand-500 dark:text-brand-400">
                    {meal.effort && <span className="text-brand-700 dark:text-brand-300">{effortLabel(meal.effort)}</span>}
                    {typeof meal.activeMin === 'number' && <span>{meal.activeMin}m active</span>}
                    <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" /> {fmtDur(sched.total)}</span>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-brand-300 dark:text-brand-500 shrink-0 mt-1" />
              </button>
            );
          })}
          {meals.length === 0 && (
            <p className="text-center text-sm text-brand-400 dark:text-brand-450 py-10">No meals in this plan.</p>
          )}
        </div>
      ) : (
        <ShoppingView
          plan={plan}
          checkedItems={checkedItems}
          onToggle={toggleItem}
        />
      )}

      {/* Bottom tab bar */}
      <div className="sticky bottom-0 mt-5 flex gap-1 p-1 bg-white dark:bg-brand-800 rounded-2xl border border-brand-200 dark:border-brand-700">
        <TabButton active={view === 'week'} onClick={() => setView('week')} icon={<CalendarDays className="w-4 h-4" />}>Week</TabButton>
        <TabButton active={view === 'shopping'} onClick={() => setView('shopping')} icon={<ShoppingCart className="w-4 h-4" />}>
          Shopping
        </TabButton>
      </div>
    </div>
  );
};

// --- Sub-components ---------------------------------------------------------

const TabButton: React.FC<{ active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }> = ({ active, onClick, icon, children }) => (
  <button
    onClick={onClick}
    className={clsx(
      'flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-colors duration-(--duration-fast) ease-(--ease-standard)',
      active ? 'bg-accent-600 text-white' : 'text-brand-500 hover:bg-brand-100 dark:text-brand-400 dark:hover:bg-brand-700/50'
    )}
  >
    {icon} {children}
  </button>
);

const Tag: React.FC<{ children: React.ReactNode; icon?: React.ReactNode; tone?: 'save' | 'warn' | 'default' }> = ({ children, icon, tone = 'default' }) => (
  <span className={clsx(
    'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xxs font-bold border',
    tone === 'save' && 'bg-brand-50 text-brand-700 border-brand-200 dark:bg-brand-700/40 dark:text-brand-200 dark:border-brand-500/40',
    tone === 'warn' && 'bg-warm-50 text-warm-700 border-warm-200 dark:bg-warm-900/40 dark:text-warm-200 dark:border-warm-700',
    tone === 'default' && 'bg-white text-brand-600 border-brand-200 dark:bg-brand-800 dark:text-brand-300 dark:border-brand-700'
  )}>
    {icon}{children}
  </span>
);

const StatCell: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex-1 px-3 py-2 text-center">
    <div className="font-bold text-brand-900 dark:text-brand-100 tabular-nums">{value}</div>
    <div className="text-xxs font-bold uppercase tracking-wide text-brand-400 dark:text-brand-450 mt-0.5">{label}</div>
  </div>
);

interface RecipeViewProps {
  meal: WeeklyPlanMeal;
  schedule: ReturnType<typeof buildSchedule>;
  serveValue: string;
  onServeChange: (v: string) => void;
  onBack: () => void;
  onStartCook: () => void;
}

const RecipeView: React.FC<RecipeViewProps> = ({ meal, schedule, serveValue, onServeChange, onBack, onStartCook }) => (
  <div>
    <Button
      variant="ghost"
      size="sm"
      className="mb-3 px-0 text-brand-500 hover:bg-transparent hover:text-brand-800 dark:text-brand-400 dark:hover:bg-transparent dark:hover:text-brand-200"
      onClick={onBack}
      leftIcon={<ChevronLeft className="w-4 h-4" />}
    >
      Week
    </Button>

    {meal.cuisine && <div className="text-xxs font-bold uppercase tracking-wide text-brand-400 dark:text-brand-450">{meal.cuisine}</div>}
    <h2 className="text-2xl font-bold text-brand-900 dark:text-brand-100 tracking-tight text-balance">{meal.name}</h2>
    {meal.blurb && <p className="text-sm text-brand-500 dark:text-brand-400 italic mt-1 leading-relaxed">{meal.blurb}</p>}

    {/* Stats strip */}
    <div className="flex items-stretch divide-x divide-brand-200 dark:divide-brand-700 border-y border-brand-200 dark:border-brand-700 my-4">
      <StatCell label="Active" value={typeof meal.activeMin === 'number' ? `${meal.activeMin}m` : '—'} />
      <StatCell label="Total" value={fmtDur(schedule.total)} />
      <StatCell label="Serves" value={meal.servesNote || '—'} />
    </div>

    {/* Scheduler */}
    <div className="rounded-2xl bg-brand-50 border border-brand-200 p-4 flex items-center justify-between gap-3 dark:bg-brand-700/40 dark:border-brand-700">
      <div>
        <label htmlFor="serve-time" className="block text-xxs font-bold uppercase tracking-wide text-brand-400 dark:text-brand-450 mb-1">Serve at</label>
        <input
          id="serve-time"
          type="time"
          value={serveValue}
          onChange={(e) => onServeChange(e.target.value)}
          className="bg-white border border-brand-200 rounded-lg px-2.5 py-1.5 text-sm font-bold text-brand-900 focus:ring-2 focus:ring-accent-500/40 focus:border-accent-500 outline-hidden dark:bg-brand-700/50 dark:border-brand-600 dark:text-brand-100"
        />
      </div>
      <div className="text-right">
        <div className="text-xxs font-bold uppercase tracking-wide text-brand-400 dark:text-brand-450">Start cooking</div>
        <div className="text-lg font-bold text-brand-700 dark:text-brand-300 tabular-nums">{fmtClock(schedule.start)}</div>
      </div>
    </div>

    {/* Hand-offs */}
    {(meal.uses?.length || meal.saves?.length) ? (
      <div className="flex flex-col gap-2 mt-4">
        {meal.uses?.map((u, k) => (
          <div key={`u${k}`} className="flex items-center gap-2 text-sm text-brand-600 bg-white border border-brand-200 rounded-xl px-3 py-2 dark:text-brand-300 dark:bg-brand-800 dark:border-brand-700">
            <ArrowLeft className="w-4 h-4 text-brand-400 dark:text-brand-450 shrink-0" />
            <span><span className="font-semibold">{u.item}</span>{u.from ? <span className="text-brand-400 dark:text-brand-450"> from {u.from}</span> : null}</span>
          </div>
        ))}
        {meal.saves?.map((s, k) => (
          <div key={`s${k}`} className="flex items-center gap-2 text-sm text-brand-800 bg-brand-50 border border-brand-200 rounded-xl px-3 py-2 dark:text-brand-200 dark:bg-brand-700/30 dark:border-brand-500/40">
            <ArrowRight className="w-4 h-4 text-brand-500 dark:text-brand-300 shrink-0" />
            <span><span className="font-semibold">{s.item}</span>{s.to ? <span className="text-brand-600/70 dark:text-brand-300/70"> for {s.to}</span> : null}</span>
          </div>
        ))}
      </div>
    ) : null}

    {/* Ingredients */}
    {meal.ingredients?.length > 0 && (
      <section className="mt-6">
        <h3 className="text-xs font-bold uppercase tracking-widest text-brand-400 dark:text-brand-450 mb-3">Mise en place</h3>
        <ul className="space-y-1.5">
          {meal.ingredients.map((ing, i) => (
            <li key={i} className="text-sm text-brand-700 dark:text-brand-300 flex items-baseline gap-2">
              <span className="w-1 h-1 rounded-full bg-brand-400 shrink-0 translate-y-1.5" />
              {ing}
            </li>
          ))}
        </ul>
      </section>
    )}

    {/* Steps */}
    <section className="mt-6">
      <h3 className="text-xs font-bold uppercase tracking-widest text-brand-400 dark:text-brand-450 mb-3">Cook in order</h3>
      <div className="space-y-3">
        {schedule.steps.map((s, i) => (
          <StepRow key={i} step={s} />
        ))}
      </div>
    </section>

    {/* Leftovers */}
    {meal.leftovers?.length ? (
      <section className="mt-6 rounded-card bg-warm-50 border border-warm-200 p-4 dark:bg-warm-900/40 dark:border-warm-700">
        <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-warm-700 dark:text-warm-200 mb-2">
          <Box className="w-4 h-4" /> Leftovers
        </h3>
        <ul className="space-y-1 text-sm text-warm-900 dark:text-warm-200">
          {meal.leftovers.map((l, i) => <li key={i}>• {l}</li>)}
        </ul>
      </section>
    ) : null}

    {schedule.steps.length > 0 && (
      <Button
        variant="primary"
        size="lg"
        className="mt-6 w-full"
        onClick={onStartCook}
        leftIcon={<ChefHat className="w-5 h-5" />}
      >
        Start Cook Mode
      </Button>
    )}
  </div>
);

const StepFlags: React.FC<{ step: ScheduledStep }> = ({ step }) => (
  <div className="flex flex-wrap gap-1.5 mt-2">
    {step.kid && <Tag icon={<Baby className="w-3 h-3" />}>Kid can help</Tag>}
    {step.off && <Tag icon={<Hourglass className="w-3 h-3" />}>Hands-off</Tag>}
    {typeof step.timer === 'number' && step.timer > 0 && (
      <Tag tone="warn" icon={<Timer className="w-3 h-3" />}>{step.timer} min timer</Tag>
    )}
  </div>
);

const StepRow: React.FC<{ step: ScheduledStep }> = ({ step }) => (
  <div className="flex gap-3">
    <div className="w-14 shrink-0 text-right">
      <div className="text-sm font-bold text-brand-700 dark:text-brand-300 tabular-nums leading-tight">{fmtClock(step.when)}</div>
      <div className="text-xxs font-bold uppercase tracking-wide text-brand-400 dark:text-brand-450 mt-0.5">{step.phase === 'prep' ? `Prep ${step.label}` : `Step ${step.label}`}</div>
    </div>
    <div className="flex-1 min-w-0 pb-3 border-b border-brand-100 dark:border-brand-700">
      <h4 className="font-bold text-brand-900 dark:text-brand-100 leading-snug">{step.t}</h4>
      {step.det?.length ? (
        <ul className="mt-1 space-y-0.5">
          {step.det.map((d, i) => <li key={i} className="text-sm text-brand-600 dark:text-brand-300 leading-relaxed">{d}</li>)}
        </ul>
      ) : null}
      <StepFlags step={step} />
    </div>
  </div>
);

// --- Shopping ---------------------------------------------------------------

interface ShoppingViewProps {
  plan: WeeklyPlan;
  checkedItems: Set<string>;
  onToggle: (id: string) => void;
}

// Positional id: stable across renders and guaranteed unique even when an
// imported/AI plan reuses the same explicit `id` across items.
const itemId = (_it: WeeklyPlanGroceryItem, i: number): string => `i${i}`;

const ShoppingView: React.FC<ShoppingViewProps> = ({ plan, checkedItems, onToggle }) => {
  const fmt = useFormatCurrency();
  const groups = groupItemsByStore(plan);
  const allItems = useMemo(() => plan.items ?? [], [plan.items]);
  const total = subtotal(allItems);
  const remaining = sumMoney(allItems.map((it, i) => (checkedItems.has(itemId(it, i)) ? 0 : itemPrice(it))));
  const itemsLeft = allItems.filter((it, i) => !checkedItems.has(itemId(it, i))).length;

  // Stable index lookup so checkbox ids match across renders.
  const indexOf = useMemo(() => {
    const map = new Map<WeeklyPlanGroceryItem, number>();
    allItems.forEach((it, i) => map.set(it, i));
    return map;
  }, [allItems]);

  return (
    <div>
      {/* Summary */}
      <div className="rounded-2xl bg-white border border-brand-200 p-4 mb-4 flex items-end justify-between dark:bg-brand-800 dark:border-brand-700">
        <div>
          <div className="text-xxs font-bold uppercase tracking-wide text-brand-400 dark:text-brand-450">Estimated total</div>
          <div className="text-3xl font-bold text-brand-900 dark:text-brand-100 tabular-nums">{fmt(total)}</div>
        </div>
        <div className="text-right">
          <div className="text-sm font-bold text-brand-700 dark:text-brand-200 tabular-nums">{itemsLeft} left</div>
          <div className="text-xxs text-brand-400 dark:text-brand-450 tabular-nums">{fmt(remaining)} to buy</div>
        </div>
      </div>

      <div className="space-y-5">
        {groups.map(group => {
          const groupSubtotal = subtotal(group.items);
          // Order sections within the store.
          const sections = Array.from(new Set(group.items.map(it => (it.sec || 'other').toLowerCase())))
            .sort((a, b) => {
              const ia = SEC_ORDER.indexOf(a); const ib = SEC_ORDER.indexOf(b);
              return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
            });
          return (
            <div key={group.key}>
              <div className="flex items-baseline justify-between px-1 mb-2">
                <div>
                  <div className="font-bold text-brand-900 dark:text-brand-100">{group.name}</div>
                  {group.why && <div className="text-xxs text-brand-400 dark:text-brand-450">{group.why}</div>}
                </div>
                <div className="text-sm font-bold text-brand-500 dark:text-brand-400 tabular-nums">{fmt(groupSubtotal)}</div>
              </div>
              {sections.map(sec => (
                <div key={sec} className="mb-2">
                  <div className="text-xxs font-bold uppercase tracking-widest text-brand-300 dark:text-brand-450 px-1 mb-1">{sec}</div>
                  <div className="rounded-2xl bg-white border border-brand-200 divide-y divide-brand-100 overflow-hidden dark:bg-brand-800 dark:border-brand-700 dark:divide-brand-700">
                    {group.items.filter(it => (it.sec || 'other').toLowerCase() === sec).map(it => {
                      const i = indexOf.get(it) ?? 0;
                      const id = itemId(it, i);
                      const checked = checkedItems.has(id);
                      return (
                        <button
                          key={id}
                          onClick={() => onToggle(id)}
                          className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-brand-50 transition-colors dark:hover:bg-brand-700/50"
                        >
                          <span className={clsx(
                            'w-6 h-6 rounded-full border flex items-center justify-center shrink-0 transition-colors',
                            checked ? 'bg-accent-600 border-accent-600 text-white' : 'border-brand-300 dark:border-brand-600'
                          )}>
                            {checked && <Check className="w-3.5 h-3.5" strokeWidth={3} />}
                          </span>
                          <span className={clsx('flex-1 min-w-0', checked && 'line-through text-brand-400 dark:text-brand-450')}>
                            <span className="text-sm font-semibold text-brand-800 dark:text-brand-200">{it.n}</span>
                            {it.q && <span className="text-xs text-brand-400 dark:text-brand-450 ml-1.5">{it.q}</span>}
                            {it.staple && <span className="ml-1.5 text-xxs font-bold text-brand-400 dark:text-brand-450">staple</span>}
                            {it.note && <span className="block text-xxs text-brand-400 dark:text-brand-450">{it.note}</span>}
                          </span>
                          {typeof it.p === 'number' && (
                            <span className={clsx('text-sm font-bold tabular-nums shrink-0', checked ? 'text-brand-300 dark:text-brand-500' : 'text-brand-600 dark:text-brand-300')}>{fmt(it.p)}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          );
        })}
        {allItems.length === 0 && (
          <p className="text-center text-sm text-brand-400 dark:text-brand-450 py-10">No shopping items in this plan.</p>
        )}
      </div>
    </div>
  );
};

// --- Cook mode --------------------------------------------------------------

const CookMode: React.FC<{ meal: WeeklyPlanMeal; steps: ScheduledStep[]; onClose: () => void }> = ({ meal, steps, onClose }) => {
  const [i, setI] = useState(0);
  const step = steps[i]; // steps is non-empty (CookMode only renders when schedule.steps.length > 0)
  const progress = steps.length ? ((i + 1) / steps.length) * 100 : 0;

  if (!step) return null;

  return (
    <div className="fixed inset-0 z-modal bg-white dark:bg-brand-900 flex flex-col p-6 pt-safe pb-safe">
      <div className="flex items-center justify-between">
        <div className="text-sm font-bold text-brand-500 dark:text-brand-400">
          {step.phase === 'prep' ? `Prep ${step.label}` : `Step ${step.label}`} · {i + 1}/{steps.length}
        </div>
        <Button variant="ghost" size="icon" className="-mr-2" onClick={onClose} aria-label="Exit cook mode">
          <X className="w-6 h-6" />
        </Button>
      </div>

      <div className="h-1.5 bg-brand-100 dark:bg-brand-800 rounded-full mt-3 overflow-hidden">
        {/* scaleX (not width) so the fill animates on the compositor without
            relayout. */}
        <div
          className="h-full w-full origin-left bg-accent-600 transition-transform duration-(--duration-base) ease-(--ease-standard)"
          style={{ transform: `scaleX(${progress / 100})` }}
        />
      </div>

      <div className="flex-1 flex flex-col justify-center min-h-0">
        <div className="text-sm font-bold text-brand-600 dark:text-brand-300 tabular-nums">{fmtClock(step.when)} · {meal.name}</div>
        <h2 className="text-3xl font-bold text-brand-900 dark:text-brand-100 tracking-tight mt-2 leading-tight text-balance">{step.t}</h2>
        {step.det?.length ? (
          <ul className="mt-4 space-y-2">
            {step.det.map((d, k) => <li key={k} className="text-lg text-brand-600 dark:text-brand-300 leading-relaxed">• {d}</li>)}
          </ul>
        ) : null}
        <StepFlags step={step} />
      </div>

      <div className="flex gap-3">
        <Button
          variant="secondary"
          size="lg"
          className="flex-1"
          onClick={() => setI(v => Math.max(0, v - 1))}
          disabled={i === 0}
          leftIcon={<ChevronLeft className="w-5 h-5" />}
        >
          Back
        </Button>
        {i < steps.length - 1 ? (
          <Button
            variant="primary"
            size="lg"
            className="flex-2"
            onClick={() => setI(v => Math.min(steps.length - 1, v + 1))}
            rightIcon={<ChevronRight className="w-5 h-5" />}
          >
            Next
          </Button>
        ) : (
          <Button
            variant="success"
            size="lg"
            className="flex-2"
            onClick={onClose}
            leftIcon={<Check className="w-5 h-5" />}
          >
            Done
          </Button>
        )}
      </div>
    </div>
  );
};

export default MealGuide;
