import React, { useState } from 'react';
import { Drawer } from '@/components/ui/Drawer';
import { useHousehold } from '@/contexts/FirebaseHouseholdContext';
import { WeeklyPlan, WeeklyPlanConstraints } from '@/types/weeklyPlan';
import { mapWeeklyPlan } from '@/utils/weeklyPlanMapper';
import { normalizeToKey } from '@/utils/stringNormalizer';
import { MealGuide } from './MealGuide';
import { Sparkles, FileJson, Loader2, CalendarPlus, ChefHat, ClipboardPaste } from 'lucide-react';
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
  const { householdId, meals, shoppingList, addMeal, addMealPlanItem, addShoppingItems } = useHousehold();

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
      const constraints: WeeklyPlanConstraints = {
        note: note.trim() || undefined,
        recentMeals: meals.slice(0, 20).map(m => m.name),
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
    if (fence) s = fence[1].trim();
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
        toast('Long-press the box below to paste', { icon: '📋' });
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
              mealId: ids[pi.mealIndex],
              mealName: mapped.meals[pi.mealIndex].name,
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

  return (
    <Drawer isOpen={isOpen} onClose={handleClose} title={title} className="max-h-[92vh]">
      {/* Choose */}
      {mode === 'choose' && (
        <div className="space-y-3 pb-2">
          <p className="text-sm text-slate-500 leading-relaxed">
            Generate a full week of dinners and a shopping list with AI, or import a plan from your
            weekly-meals project.
          </p>
          <button
            onClick={() => setMode('generate')}
            className="w-full flex items-center gap-3 p-4 rounded-2xl bg-violet-50 border border-violet-100 text-left hover:bg-violet-100 transition-colors"
          >
            <span className="w-10 h-10 rounded-xl bg-violet-600 text-white flex items-center justify-center shrink-0"><Sparkles className="w-5 h-5" /></span>
            <span>
              <span className="block font-bold text-slate-900">Generate with AI</span>
              <span className="block text-xs text-slate-500">3 balanced dinners + grocery list via Gemini</span>
            </span>
          </button>
          <button
            onClick={() => setMode('import')}
            className="w-full flex items-center gap-3 p-4 rounded-2xl bg-emerald-50 border border-emerald-100 text-left hover:bg-emerald-100 transition-colors"
          >
            <span className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0"><FileJson className="w-5 h-5" /></span>
            <span>
              <span className="block font-bold text-slate-900">Import week.json</span>
              <span className="block text-xs text-slate-500">Paste a plan from weekly-meals</span>
            </span>
          </button>
        </div>
      )}

      {/* Generate */}
      {mode === 'generate' && (
        <div className="space-y-4 pb-2">
          <div>
            <label htmlFor="plan-note" className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
              Anything to use up? <span className="font-medium normal-case text-slate-300">(optional)</span>
            </label>
            <textarea
              id="plan-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="e.g. use the ground beef in the freezer, keep it quick this week"
              className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500 outline-none"
            />
          </div>
          <div className="flex gap-3">
            <button onClick={() => setMode('choose')} className="flex-1 py-3 bg-slate-100 text-slate-700 font-bold rounded-xl hover:bg-slate-200 transition-colors">Back</button>
            <button
              onClick={handleGenerate}
              disabled={busy}
              className="flex-[2] flex items-center justify-center gap-2 py-3 bg-violet-600 text-white font-bold rounded-xl shadow-lg hover:bg-violet-700 disabled:opacity-60 transition-all active:scale-95"
            >
              {busy ? <><Loader2 className="w-5 h-5 animate-spin" /> Planning…</> : <><Sparkles className="w-5 h-5" /> Generate</>}
            </button>
          </div>
        </div>
      )}

      {/* Import */}
      {mode === 'import' && (
        <div className="space-y-3 pb-2">
          <p className="text-sm text-slate-500 leading-relaxed">
            Copy the week.json from your weekly-meals app, then tap paste — a code fence or
            extra text around it is fine.
          </p>
          <button
            onClick={handlePasteFromClipboard}
            className="w-full flex items-center justify-center gap-2 py-3.5 bg-emerald-600 text-white font-bold rounded-xl shadow-lg hover:bg-emerald-700 transition-all active:scale-95"
          >
            <ClipboardPaste className="w-5 h-5" /> Paste from clipboard
          </button>
          <div className="text-center text-xxs font-bold uppercase tracking-wider text-slate-300">or paste manually</div>
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            rows={6}
            placeholder='Paste week.json here…'
            className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500 outline-none"
          />
          <div className="flex gap-3">
            <button onClick={() => setMode('choose')} className="flex-1 py-3 bg-slate-100 text-slate-700 font-bold rounded-xl hover:bg-slate-200 transition-colors">Back</button>
            <button
              onClick={handleImport}
              disabled={!importText.trim()}
              className="flex-[2] flex items-center justify-center gap-2 py-3 bg-slate-800 text-white font-bold rounded-xl shadow-lg hover:bg-slate-900 disabled:opacity-50 transition-all active:scale-95"
            >
              <ChefHat className="w-5 h-5" /> Preview
            </button>
          </div>
        </div>
      )}

      {/* Preview */}
      {mode === 'preview' && plan && (
        <div className="space-y-4">
          <MealGuide plan={plan} />
          <div className="sticky bottom-0 bg-white pt-2 pb-1 flex gap-3 border-t border-slate-100">
            <button onClick={reset} className="flex-1 py-3 bg-slate-100 text-slate-700 font-bold rounded-xl hover:bg-slate-200 transition-colors">Discard</button>
            <button
              onClick={handleApply}
              disabled={busy}
              className="flex-[2] flex items-center justify-center gap-2 py-3 bg-brand-800 text-white font-bold rounded-xl shadow-lg hover:bg-brand-900 disabled:opacity-60 transition-all active:scale-95"
            >
              {busy ? <><Loader2 className="w-5 h-5 animate-spin" /> Adding…</> : <><CalendarPlus className="w-5 h-5" /> Add to my week</>}
            </button>
          </div>
        </div>
      )}
    </Drawer>
  );
};

export default WeeklyPlanModal;
