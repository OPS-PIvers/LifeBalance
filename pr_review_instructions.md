# Transaction Habit Tagging & Approval Flow Improvements

## Summary
This PR dramatically improves the transaction habit tagging experience and fixes the confusing pending transaction approval flow. The system now intelligently suggests relevant habits based on keywords and historical associations, and provides an explicit approval button instead of auto-approving on category selection.

## Changes Made

### 1. Smart Habit Suggestion System ([utils/habitSuggestions.ts](utils/habitSuggestions.ts))

**New utility file** that provides intelligent habit suggestions for transactions using:

- **Keyword Matching**: 100+ merchant keywords mapped to habit categories (e.g., "Starbucks" → coffee/food habits)
- **Historical Learning**: Analyzes past transaction-habit associations to suggest habits you've previously linked to similar merchants
- **Confidence Scoring**:
  - `high` = Previously used for this exact/similar merchant
  - `medium` = Keyword match found
  - `low` = Other habits (shown only if selected or in "More" section)

**Key Functions:**
- `suggestHabitsForTransaction()` - Returns scored & sorted habit suggestions
- `getTopHabitSuggestions()` - Returns only high-confidence suggestions

### 2. ActionQueueItem Improvements ([components/dashboard/ActionQueueItem.tsx](components/dashboard/ActionQueueItem.tsx))

**Before:**
- ❌ All habits listed in one big unorganized list
- ❌ Clicking a bucket category instantly approves the transaction
- ❌ Confusing UX: pre-selected bucket still needs to be tapped to approve

**After:**
- ✅ Smart habit suggestions shown first with visual indicators:
  - Purple border + pulse dot = High confidence (historical match)
  - Blue border = Medium confidence (keyword match)
- ✅ Non-suggested habits collapsed under "+ More" button
- ✅ Selected habits always visible
- ✅ **Explicit "Approve Transaction" button** separate from category selection
- ✅ Can change bucket category without auto-approving
- ✅ Clear feedback with toast notification on approval

**Visual Indicators:**
- Sparkles icon (✨) appears when smart suggestions are available
- High-confidence habits have animated pulse indicator
- Selected habits show green checkmark

### 3. Manual Transaction Entry ([components/modals/CaptureModal.tsx](components/modals/CaptureModal.tsx))

**Before:**
- ❌ No ability to tag habits during manual entry
- ❌ Had to edit transaction later to add habits

**After:**
- ✅ Optional "Connect Habits" section in manual entry form
- ✅ Smart suggestions update as you type the merchant name
- ✅ Same visual design as ActionQueueItem for consistency
- ✅ Habits saved with transaction immediately (in `relatedHabitIds` field)
- ✅ Works for both verified and pending transactions

### 4. AI-Scanned Transactions
**No changes needed** - AI receipt scanning already populates `relatedHabitIds`, which now:
- Seeds the historical learning system
- Pre-selects suggested habits when reviewing in Action Queue

## How It Works Together

### Flow Example: Adding a Coffee Shop Transaction

1. **Manual Entry:**
   ```
   User types "Starbucks" → System suggests:
   - [HIGH] ☕ Coffee Run (you linked this 3x before)
   - [MEDIUM] 🍔 Fast Food (keyword: coffee)
   - + More (12) ← Other habits collapsed
   ```

2. **Pending Review (Action Queue):**
   ```
   User expands transaction → Sees same smart suggestions
   - Select/deselect habits
   - Choose bucket category (doesn't approve yet)
   - Click "Approve Transaction" button
   ```

3. **Learning:**
   ```
   Next time user enters "Starbucks" or similar coffee shop:
   - Same habits suggested automatically
   - Builds personal merchant-habit associations
   ```

## Technical Details

### Data Storage
- Habit associations stored in `Transaction.relatedHabitIds: string[]`
- No schema changes required
- Backwards compatible (undefined = no habits)

### Performance
- `useMemo` hooks prevent unnecessary re-calculations
- Suggestions computed only when merchant name changes
- O(n) complexity for history scanning (acceptable for typical transaction counts)

### Keyword Categories Covered
- Food & Drink: restaurants, coffee, fast food, grocery, alcohol
- Exercise & Health: gyms, sports, healthcare
- Shopping & Entertainment: retail, streaming, gaming
- Transportation: gas, ride-share, parking
- Personal Care: salons, beauty, spa
- Hobbies & Learning: books, courses, education

## Testing Checklist

- [ ] Smart suggestions appear when typing merchant name in manual entry
- [ ] High-confidence habits (purple border) show for repeated merchants
- [ ] "More" button expands to show all other habits
- [ ] Selected habits remain visible when collapsed
- [ ] Category selection doesn't auto-approve transaction
- [ ] "Approve Transaction" button requires category selection
- [ ] Toast notification appears on successful approval
- [ ] Habit associations persist after approval
- [ ] Historical learning improves suggestions over time
- [ ] Build succeeds with no TypeScript errors ✅

## User Experience Wins

1. **Faster habit tagging**: Top suggestions visible immediately, no scrolling
2. **Learns your patterns**: Repeatedly linking Starbucks → Coffee? Auto-suggests next time
3. **Less overwhelming**: Only 3-5 suggested habits shown by default vs. all habits
4. **Clear approval flow**: Explicit button removes confusion
5. **Consistent UI**: Same design in manual entry and pending review

## Files Changed

- `utils/habitSuggestions.ts` - **NEW** Smart suggestion engine
- `components/dashboard/ActionQueueItem.tsx` - Explicit approve button + smart suggestions
- `components/modals/CaptureModal.tsx` - Added habit tagging to manual entry

## Breaking Changes

None - fully backwards compatible.

## Future Enhancements

Potential improvements for later:
- Allow users to add custom merchant-habit keyword mappings
- Show habit suggestion reasons in UI tooltip
- Add "Always link this merchant to these habits" option
- Suggest habits based on transaction amount ranges
- Category-based habit suggestions (e.g., Groceries → Meal Prep habits)
