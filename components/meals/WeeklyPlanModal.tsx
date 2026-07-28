import React, { useState } from 'react';
import { Drawer } from '@/components/ui/Drawer';
import { Button } from '@/components/ui/Button';
import { useMealPlan, useShopping, useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { WeeklyPlan, WeeklyPlanConstraints } from '@/types/weeklyPlan';
import { mapWeeklyPlan } from '@/utils/weeklyPlanMapper';
import { normalizeToKey } from '@/utils/stringNormalizer';
import { MealGuide } from './MealGuide';
import { Sparkles, FileJson, CalendarPlus, ChefHat, ClipboardPaste } from 'lucide-react';
import { toastIcon } from '@/components/ui/toastIcon';
import toast from 'react-hot-toast';

type Mode = 'choose' | 'generate' | 'import' | 'preview';

interface WeeklyPlanModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Monday of the week the plan should land on (YYYY-MM-DD). */
  weekStart: string;
}

/**
 * Drives the "Plan My Week" flow: generate a weekly plan with Gemini or import
 * a weekly-meals week.json, preview it in the Meal Guide, then apply it —
 * writing the meals, dinners and shopping list into the household.
 */
export const WeeklyPlanModal: React.FC<WeeklyPlanModalProps> = ({ isOpen, onClose, weekStart }) => {
  const { meals, addMeal, addMealPlanItem } = useMealPlan();
  const { shoppingList, addShoppingItems } = useShopping();
  const { householdId, householdSettings } = useHouseholdCore();

  const [mode, setMode] = useState<Mode>('choose');
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<WeeklyPlan | null>(null);

  // Generate options
  const [note, setNote] = useState('');
  // Import
  const [importText, setImportText] = useState('');

  const reset = () => {
    setMode('choose');
    setBusy(false);
    setPlan(null);
    setNote('');
    setImportText('');
  };

  const handleClose = () => { reset(); onClose(); };

  const handleGenerate = async () => {
    if (!householdId) { toast.error('Household not found'); return; }
    setBusy(true);
    try {
      const { generateWeeklyPlan } = await import('@/services/geminiService');
      const dietaryProfile = householdSettings?.dietaryProfile;
      const constraints: WeeklyPlanConstraints = {
        note: note.trim() || undefined,
        recentMeals: meals.slice(0, 20).map(m => m.name),
        allergies: dietaryProfile?.allergens?.length ? dietaryProfile.allergens : undefined,
        restrictions: dietaryProfile?.restrictions?.length ? dietaryProfile.restrictions : undefined,
      };
      const result = await generateWeeklyPlan(householdId, weekStart, constraints);
      setPlan(result);
      setMode('preview');
    } catch (_e) {
      toast.error('Failed to generate plan');
    } finally {
      setBusy(false);
    }
  };

  // Pull JSON out of a mobile copy/paste: tolerate a wrapping ```json fence or
  // surrounding chat text by falling back to the outermost { … }.
  const extractJson = (raw: string): string => {
    let s = raw.trim();
    const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/m.exec(s);
    if (fence) s = fence[1]!.trim(); // capture group 1 always present when exec() succeeds
    if (!s.startsWith('{')) {
      const first = s.indexOf('{');
      const last = s.lastIndexOf('}');
      if (first !== -1 && last > first) s = s.slice(first, last + 1);
    }
    return s;
  };

  const importPlan = (raw: string) => {
    const text = extractJson(raw);
    if (!text) { toast.error('Paste your week.json first'); return; }

    let parsed: WeeklyPlan;
    try {
      parsed = JSON.parse(text) as WeeklyPlan;
    } catch {
      toast.error("That isn't valid JSON — copy the whole week.json and try again");
      return;
    }
    if (!parsed || !Array.isArray(parsed.meals) || parsed.meals.length === 0) {
      toast.error('No meals found in that plan');
      return;
    }
    // Ensure a weekOf so dinners can be scheduled.
    if (!parsed.weekOf) parsed.weekOf = weekStart;

    setImportText(text);
    setPlan(parsed);
    setMode('preview');
  };

  const handleImport = () => importPlan(importText);

  const handlePasteFromClipboard = async () => {
    try {
      if (!navigator.clipboard?.readText) {
        toast('Long-press the box below to paste', { icon: toastIcon(ClipboardPaste) });
        return;
      }
      const text = await navigator.clipboard.readText();
      if (!text.trim()) { toast.error('Clipboard is empty'); return; }
      importPlan(text);
    } catch {
      toast.error("Couldn't read clipboard — paste into the box instead");
    }
  };

  const handleApply = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      const mapped = mapWeeklyPlan(plan, { startDate: weekStart });

      // Create meals (one combined toast below, not one per meal), then
      // schedule each as a dinner using its new id.
      const ids = await Promise.all(mapped.meals.map(m => addMeal(m, { suppressToast: true })));
      await Promise.all(
        mapped.planItems.map(pi =>
          addMealPlanItem(
            {
              date: pi.date,
              type: pi.type,
              mealId: ids[pi.mealIndex]!, // pi.mealIndex is a valid index into the parallel ids array
              mealName: mapped.meals[pi.mealIndex]!.name, // pi.mealIndex is a valid index into mapped.meals
              isCooked: false,
            },
            { suppressToast: true },
          ),
        ),
      );

      // Skip grocery items already on the unpurchased list, and continue the
      // existing order sequence — same dedupe the manual "shop ingredients"
      // flow uses, so applying a plan never doubles up the list.
      const existing = new Set(
        shoppingList.filter(s => !s.isPurchased).map(s => normalizeToKey(s.name)),
      );
      const itemsToAdd = mapped.shoppingItems
        .filter(it => !existing.has(normalizeToKey(it.name)))
        .map((it, i) => ({ ...it, order: shoppingList.length + i }));

      if (itemsToAdd.length > 0) {
        await addShoppingItems(itemsToAdd);
      }

      toast.success(`Added ${mapped.meals.length} meals & ${itemsToAdd.length} items`);
      handleClose();
    } catch (e) {
      console.error('Apply weekly plan failed:', e);
      toast.error('Failed to add plan');
    } finally {
      setBusy(false);
    }
  };

  const title =
    mode === 'preview' ? (plan?.weekLabel || 'Week preview')
    : mode === 'generate' ? 'Plan my week'
    : mode === 'import' ? 'Import week.json'
    : 'Plan my week';

  const footerBarClass = 'bg-white dark:bg-brand-800 p-4 flex gap-3 border-t border-brand-200 dark:border-brand-700';

  // One action bar per mode. 'choose' has no primary action — its two tiles ARE
  // the choice — so it stays undefined and the body keeps its pb-safe inset.
  const footer =
    mode === 'preview' && plan ? (
      <div className={footerBarClass}>
        <Button variant="secondary" size="lg" className="flex-1" onClick={reset}>Discard</Button>
        <Button
          variant="primary"
          size="lg"
          className="flex-2"
          onClick={handleApply}
          isLoading={busy}
          leftIcon={<CalendarPlus className="w-5 h-5" />}
        >
          Add to my week
        </Button>
      </div>
    ) : mode === 'generate' ? (
      <div className={footerBarClass}>
        <Button variant="secondary" size="lg" className="flex-1" onClick={() => setMode('choose')}>Back</Button>
        <Button
          variant="warning"
          size="lg"
          className="flex-2"
          onClick={handleGenerate}
          isLoading={busy}
          leftIcon={<Sparkles className="w-5 h-5" />}
        >
          Generate
        </Button>
      </div>
    ) : mode === 'import' ? (
      <div className={footerBarClass}>
        <Button variant="secondary" size="lg" className="flex-1" onClick={() => setMode('choose')}>Back</Button>
        <Button
          variant="primary"
          size="lg"
          className="flex-2"
          onClick={handleImport}
          disabled={!importText.trim()}
          leftIcon={<ChefHat className="w-5 h-5" />}
        >
          Preview
        </Button>
      </div>
    ) : undefined;

  return (
    <Drawer
      isOpen={isOpen}
      onClose={handleClose}
      title={title}
      className="max-h-[92vh]"
      footer={footer}
    >
      {/* Choose */}
      {mode === 'choose' && (
        <div className="space-y-3 pb-2">
          <p className="text-sm text-brand-500 dark:text-brand-400 leading-relaxed">
            Generate a full week of dinners and a shopping list with AI, or import a plan from your
            weekly-meals project.
          </p>
          <button
            onClick={() => setMode('generate')}
            className="w-full flex items-center gap-3 p-4 rounded-2xl bg-warm-50 border border-warm-200 text-left hover:bg-warm-100 transition-colors duration-(--duration-fast) ease-(--ease-standard) dark:bg-warm-500/15 dark:border-warm-500/25 dark:hover:bg-warm-500/25"
          >
            <span className="w-10 h-10 rounded-xl bg-warm-500 text-white flex items-center justify-center shrink-0"><Sparkles className="w-5 h-5" /></span>
            <span>
              <span className="block font-bold text-brand-900 dark:text-brand-100">Generate with AI</span>
              <span className="block text-xs text-brand-500 dark:text-brand-400">3 balanced dinners + grocery list via Gemini</span>
            </span>
          </button>
          <button
            onClick={() => setMode('import')}
            className="w-full flex items-center gap-3 p-4 rounded-2xl bg-accent-50 border border-accent-200 text-left hover:bg-accent-100 transition-colors duration-(--duration-fast) ease-(--ease-standard) dark:bg-accent-500/15 dark:border-accent-500/25 dark:hover:bg-accent-500/25"
          >
            <span className="w-10 h-10 rounded-xl bg-accent-600 text-white flex items-center justify-center shrink-0"><FileJson className="w-5 h-5" /></span>
            <span>
              <span className="block font-bold text-brand-900 dark:text-brand-100">Import week.json</span>
              <span className="block text-xs text-brand-500 dark:text-brand-400">Paste a plan from weekly-meals</span>
            </span>
          </button>
        </div>
      )}

      {/* Generate */}
      {mode === 'generate' && (
        <div className="space-y-4 pb-2">
          <div>
            <label htmlFor="plan-note" className="block text-xs font-bold uppercase tracking-wider text-brand-400 dark:text-brand-450 mb-2">
              Anything to use up? <span className="font-medium normal-case text-brand-300 dark:text-brand-450">(optional)</span>
            </label>
            <textarea
              id="plan-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="e.g. use the ground beef in the freezer, keep it quick this week"
              className="w-full p-3 bg-brand-50 border border-brand-200 rounded-xl text-sm focus:ring-2 focus:ring-accent-500/40 focus:border-accent-500 outline-hidden dark:bg-brand-700/50 dark:border-brand-600 dark:text-brand-200 dark:placeholder:text-brand-450"
            />
          </div>
        </div>
      )}

      {/* Import */}
      {mode === 'import' && (
        <div className="space-y-3 pb-2">
          <p className="text-sm text-brand-500 dark:text-brand-400 leading-relaxed">
            Copy the week.json from your weekly-meals app, then tap paste — a code fence or
            extra text around it is fine.
          </p>
          <Button
            variant="primary"
            size="lg"
            className="w-full"
            onClick={handlePasteFromClipboard}
            leftIcon={<ClipboardPaste className="w-5 h-5" />}
          >
            Paste from clipboard
          </Button>
          <div className="text-center text-xxs font-bold uppercase tracking-wider text-brand-300 dark:text-brand-450">or paste manually</div>
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            rows={6}
            placeholder='Paste week.json here…'
            className="w-full p-3 bg-brand-50 border border-brand-200 rounded-xl text-xs font-mono focus:ring-2 focus:ring-accent-500/40 focus:border-accent-500 outline-hidden dark:bg-brand-700/50 dark:border-brand-600 dark:text-brand-200 dark:placeholder:text-brand-450"
          />
        </div>
      )}

      {/* Preview */}
      {mode === 'preview' && plan && (
        <MealGuide plan={plan} />
      )}
    </Drawer>
  );
};

export default WeeklyPlanModal;
