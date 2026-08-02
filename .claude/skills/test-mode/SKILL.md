---
name: test-mode
description: Run LifeBalance's Test Mode — a Firebase-free, mock-data sandbox for exploring or verifying the app in a browser. Use when you need to drive the running app without real credentials or a backend, when seeding mock accounts/habits/transactions, or when verifying that mock code stayed out of a production build.
---

# Test Mode

LifeBalance includes a **secure test mode** specifically designed for AI coding agents to explore and test the application without requiring Firebase authentication or a real backend.

## Activating Test Mode

**Requirements:**
1. Must be running in development mode (`pnpm dev`)
2. Must have `VITE_ENABLE_TEST_MODE=true` in your `.env.local` file
3. Navigate to: `http://localhost:3000/#/login?test=true`

**Security Features:**
- ✅ Only works in development (`import.meta.env.DEV`)
- ✅ Requires explicit environment variable (`VITE_ENABLE_TEST_MODE=true`)
- ✅ Mock code is **excluded from production builds** via dynamic imports
- ✅ Session-only persistence (cleared on browser restart)
- ✅ Visible orange banner: "🧪 TEST MODE - MOCK DATA"

## What Test Mode Provides

**Mock Authentication:**
- Pre-authenticated as "Test User" (test@example.com)
- Mock household ID: `test-household-id`
- No Firebase calls required

**Mock Data** (seeded in [contexts/MockHouseholdContext.tsx](../../../contexts/MockHouseholdContext.tsx)):
- **Accounts**: 3 sample accounts (checking, savings, credit)
- **Budget Buckets**: 4 categories
- **Transactions**: 2 sample transactions
- **Habits**: 3 (2 shared + 1 kid-assigned chore)
- **Stores**: 2
- **Members**: 2 (the admin test user with points + a managed kid profile for Kid Mode)
- Plus seed challenges, rewards, redemptions, todos, and a grocery catalog

**Full CRUD Operations:**
All context methods are fully implemented with **in-memory persistence**:
- ✅ Add/Update/Delete accounts, buckets, transactions
- ✅ Add/Update/Delete habits, calendar items
- ✅ Add/Update/Delete meals, shopping items
- ✅ Add/Update/Delete todos, stores
- ✅ Toggle habits, update balances
- ✅ All operations show toast notifications

## Example Usage

```bash
# 1. Add to .env.local
echo "VITE_ENABLE_TEST_MODE=true" >> .env.local

# 2. Start dev server
pnpm dev

# 3. Navigate to test mode URL
# Browser: http://localhost:3000/#/login?test=true

# 4. Application loads with mock data, no login required
```

## Implementation Details

**Files:**
- [contexts/MockAuthContext.tsx](../../../contexts/MockAuthContext.tsx) - Mock authentication provider
- [contexts/MockHouseholdContext.tsx](../../../contexts/MockHouseholdContext.tsx) - Mock data provider with full CRUD
- [App.tsx](../../../App.tsx) - Dynamic import logic (tree-shaken in production)
- [pages/Login.tsx](../../../pages/Login.tsx) - Test mode activation (`?test=true` sets the sessionStorage flag)

**Key Architecture:**
- Uses **dynamic imports** (`import()`) to load mock providers
- Mock code is automatically **tree-shaken** from production builds
- Providers swap at runtime based on test mode flag
- All state is kept in-memory (React useState) - no Firebase calls

`MockHouseholdContext` mirrors the domain-sliced contexts (`useFinance`, `useGamification`, `useMealPlan`, `useShopping`, `useTodos`, `useHouseholdCore`) that `FirebaseHouseholdContext` exposes, so a component migrated onto a narrow slice keeps working here.

## Deactivating Test Mode

Test mode automatically deactivates when:
- User signs out
- Browser/tab is closed (session storage cleared)
- User navigates to login without `?test=true` parameter

Or manually:
```javascript
sessionStorage.removeItem('LIFEBALANCE_TEST_MODE');
window.location.reload();
```

## Production Safety

**Multiple layers of protection:**
1. **Build-time**: Mock code excluded via dynamic imports
2. **Runtime**: Requires `import.meta.env.DEV === true`
3. **Environment**: Requires `VITE_ENABLE_TEST_MODE=true`
4. **Session**: Only persists in sessionStorage (not localStorage)

**Verification:**
```bash
# Build for production
pnpm run build

# Check bundle - mock code should NOT be present
grep -r "MockAuthProvider" dist/   # Should return nothing
grep -r "TEST MODE" dist/           # Should return nothing
```
