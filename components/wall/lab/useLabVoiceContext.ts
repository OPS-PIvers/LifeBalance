import { useMemo } from 'react';
import { useHouseholdCore, useShopping } from '@/contexts/FirebaseHouseholdContext';
import { getLocalDateString } from '@/utils/dateHelpers';
import type { WallVoiceContext } from '@/services/geminiService.types';

/** The household grounding a lab voice command is parsed against. */
export function useLabVoiceContext(): { householdId: string | null; ctx: WallVoiceContext } {
  const { householdId, members } = useHouseholdCore();
  const { groceryCatalog } = useShopping();
  const ctx = useMemo<WallVoiceContext>(
    () => ({
      memberNames: members.map(m => m.displayName).filter(Boolean),
      catalogNames: [...groceryCatalog]
        .sort((a, b) => (b.purchaseCount ?? 0) - (a.purchaseCount ?? 0))
        .map(item => item.name),
      today: getLocalDateString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }),
    [members, groceryCatalog]
  );
  return { householdId, ctx };
}
