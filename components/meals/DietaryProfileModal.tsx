import React, { useState } from 'react';
import { useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { Drawer } from '@/components/ui/Drawer';
import { Button } from '@/components/ui/Button';
import { Section } from '@/components/ui/Section';
import { Plus, X, ShieldAlert, Salad } from 'lucide-react';
import toast from 'react-hot-toast';

interface DietaryProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * F-MEALS-03 — editor for the household's standing dietary restrictions and
 * allergens. Saved to `Household.dietaryProfile`, which `suggestMeal()` and
 * `generateWeeklyPlan()` then default-populate into their AI constraints, and
 * which the recipe allergen badge (`utils/allergenCheck.ts`) matches against
 * ingredient names.
 */
export const DietaryProfileModal: React.FC<DietaryProfileModalProps> = ({ isOpen, onClose }) => {
  const { householdSettings, setDietaryProfile } = useHouseholdCore();

  const [allergens, setAllergens] = useState<string[]>(householdSettings?.dietaryProfile?.allergens ?? []);
  const [restrictions, setRestrictions] = useState<string[]>(householdSettings?.dietaryProfile?.restrictions ?? []);
  const [newAllergen, setNewAllergen] = useState('');
  const [newRestriction, setNewRestriction] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Re-seed local editable state from the live profile whenever the drawer
  // transitions from closed to open, so a re-open always shows the latest
  // saved values (the Drawer/LazyMount keep this component mounted between
  // opens). Guarded set-state-during-render — the documented React pattern
  // for deriving state from a prop change without an effect (see LazyMount).
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen && !wasOpen) {
    setWasOpen(true);
    setAllergens(householdSettings?.dietaryProfile?.allergens ?? []);
    setRestrictions(householdSettings?.dietaryProfile?.restrictions ?? []);
    setNewAllergen('');
    setNewRestriction('');
  } else if (!isOpen && wasOpen) {
    setWasOpen(false);
  }

  const addAllergen = () => {
    const trimmed = newAllergen.trim();
    if (!trimmed || allergens.some(a => a.toLowerCase() === trimmed.toLowerCase())) return;
    setAllergens(prev => [...prev, trimmed]);
    setNewAllergen('');
  };

  const addRestriction = () => {
    const trimmed = newRestriction.trim();
    if (!trimmed || restrictions.some(r => r.toLowerCase() === trimmed.toLowerCase())) return;
    setRestrictions(prev => [...prev, trimmed]);
    setNewRestriction('');
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await setDietaryProfile({ allergens, restrictions });
      onClose();
    } catch (error) {
      console.error('[DietaryProfileModal] Failed to save dietary profile:', error);
      toast.error('Failed to save dietary profile');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title="Dietary profile"
      footer={
        <Button variant="primary" size="lg" className="w-full" onClick={handleSave} isLoading={isSaving}>
          Save
        </Button>
      }
    >
      <div className="space-y-6 pb-2">
        <p className="text-sm text-brand-500 dark:text-brand-400 leading-relaxed">
          Recorded once here, allergies and restrictions are automatically applied to every AI meal
          suggestion and weekly plan — no need to type them in each time.
        </p>

        <Section title="Allergens">
          <p className="text-xs text-brand-400 dark:text-brand-450 px-1 mb-2">Hard exclusions — never proposed in any form.</p>
          <div className="flex gap-2 mb-3">
            <input
              type="text"
              value={newAllergen}
              onChange={(e) => setNewAllergen(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addAllergen())}
              placeholder="e.g. peanuts"
              className="flex-1 p-2 bg-white border border-brand-200 rounded-lg text-base focus:ring-2 focus:ring-accent-500/40 focus:border-accent-500 outline-hidden dark:bg-brand-800 dark:border-brand-700 dark:text-brand-200 dark:placeholder:text-brand-450"
            />
            <Button variant="primary" onClick={addAllergen} disabled={!newAllergen.trim()} aria-label="Add allergen">
              <Plus className="w-4 h-4" />
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {allergens.length === 0 && (
              <p className="text-xs text-brand-400 dark:text-brand-450">No allergens recorded.</p>
            )}
            {allergens.map(a => (
              <div key={a} className="flex items-center gap-1 bg-money-bgNeg border border-money-neg/20 pl-3 pr-1 py-1.5 rounded-full text-sm dark:bg-money-neg/15 dark:border-money-neg/25">
                <ShieldAlert className="w-3.5 h-3.5 text-money-neg dark:text-money-negDark shrink-0" />
                <span className="text-brand-700 dark:text-brand-200 font-medium">{a}</span>
                <button
                  type="button"
                  onClick={() => setAllergens(prev => prev.filter(x => x !== a))}
                  className="p-1 text-brand-400 hover:text-money-neg hover:bg-money-bgNeg rounded-full transition-colors dark:text-brand-450 dark:hover:text-money-negDark dark:hover:bg-money-neg/15"
                  aria-label={`Remove allergen ${a}`}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Restrictions">
          <p className="text-xs text-brand-400 dark:text-brand-450 px-1 mb-2">Softer preferences (e.g. vegetarian) honored by AI suggestions.</p>
          <div className="flex gap-2 mb-3">
            <input
              type="text"
              value={newRestriction}
              onChange={(e) => setNewRestriction(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addRestriction())}
              placeholder="e.g. vegetarian"
              className="flex-1 p-2 bg-white border border-brand-200 rounded-lg text-base focus:ring-2 focus:ring-accent-500/40 focus:border-accent-500 outline-hidden dark:bg-brand-800 dark:border-brand-700 dark:text-brand-200 dark:placeholder:text-brand-450"
            />
            <Button variant="primary" onClick={addRestriction} disabled={!newRestriction.trim()} aria-label="Add restriction">
              <Plus className="w-4 h-4" />
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {restrictions.length === 0 && (
              <p className="text-xs text-brand-400 dark:text-brand-450">No restrictions recorded.</p>
            )}
            {restrictions.map(r => (
              <div key={r} className="flex items-center gap-1 bg-white border border-brand-200 pl-3 pr-1 py-1.5 rounded-full text-sm dark:bg-brand-800 dark:border-brand-700">
                <Salad className="w-3.5 h-3.5 text-accent-600 dark:text-accent-400 shrink-0" />
                <span className="text-brand-700 dark:text-brand-200 font-medium">{r}</span>
                <button
                  type="button"
                  onClick={() => setRestrictions(prev => prev.filter(x => x !== r))}
                  className="p-1 text-brand-400 hover:text-money-neg hover:bg-money-bgNeg rounded-full transition-colors dark:text-brand-450 dark:hover:text-money-negDark dark:hover:bg-money-neg/15"
                  aria-label={`Remove restriction ${r}`}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </Drawer>
  );
};
