# Setup Guide for AI Coding Agents

This guide helps AI coding agents (like Jules, Claude Code, Cursor, etc.) quickly set up and explore the LifeBalance project using **Test Mode**.

## Quick Start (3 steps)

```bash
# 1. Run the setup script
./setup-test-mode.sh

# 2. Start the dev server
npm run dev

# 3. Navigate to test mode URL
# Open: http://localhost:3000/#/login?test=true
```

That's it! You'll now have a fully functional LifeBalance instance with mock data.

## What is Test Mode?

Test Mode is a **secure development feature** that allows AI agents to:
- ✅ Explore the full application without Firebase authentication
- ✅ Test all CRUD operations with in-memory mock data
- ✅ See real UI components and interactions
- ✅ Make changes and see results immediately
- ✅ No API keys or credentials required

## What You Get

When test mode is active, you'll see:

**Visual Indicator:**
- Orange banner at top: "🧪 TEST MODE - MOCK DATA"

**Mock Data:**
- **User**: Test User (test@example.com)
- **Accounts**: Checking ($5,000), Savings ($10,000), Credit Card (-$500)
- **Budget Buckets**: Groceries, Entertainment, Utilities, Gas
- **Habits**: Morning Workout, Drink Water
- **Transactions**: Sample expense entries
- **Stores**: Safeway, Costco

**Full Functionality:**
- Add/edit/delete accounts, transactions, budgets
- Track habits, view streaks, earn points
- Plan meals, create shopping lists
- All standard app features work (except AI features requiring API keys)

## Project Architecture Quick Reference

**State Management:**
- Single React Context: `FirebaseHouseholdContext`
- Test mode uses: `MockHouseholdContext` (same interface)

**Key Routes:**
- `/` - Dashboard
- `/budget` - Finance management
- `/habits` - Habit tracker
- `/meals` - Meal planning
- `/settings` - App settings

**Tech Stack:**
- React 18 + TypeScript
- Vite (dev server on port 3000)
- Tailwind CSS (via CDN)
- Firebase (mocked in test mode)
- React Router (HashRouter)

**File Organization:**
```
/components     - Reusable UI components
/pages          - Route-level pages
/contexts       - State management (Auth + Household)
/services       - External APIs (Firebase, Gemini)
/types          - TypeScript interfaces
/utils          - Business logic utilities
```

## Common Tasks

### Making Code Changes

1. **Edit any file** - Changes hot-reload automatically
2. **Test in browser** - See results at localhost:3000
3. **Check for errors** - Open browser console (F12)

### Adding New Features

```bash
# Example: Adding a new component
# 1. Create the file
touch src/components/myNewComponent.tsx

# 2. Edit it (changes appear instantly)

# 3. Import and use it in a page
# pages/Dashboard.tsx: import MyNewComponent from '@/components/myNewComponent'
```

### Running Tests/Linting

```bash
# Check for TypeScript errors
npm run build

# Run linter
npm run lint
```

## Important Notes

### Code Quality Rules

⚠️ **CRITICAL**: Never suppress linting/type errors without fixing the root cause.

**Forbidden patterns:**
```typescript
/* eslint-disable */        // ❌ Never do this
// @ts-ignore              // ❌ Never do this
// @ts-expect-error        // ❌ Never do this
```

See [CLAUDE.md](CLAUDE.md#code-quality-standards) for full rules.

### Test Mode Limitations

**What doesn't work in test mode:**
- ❌ Firebase authentication (mocked)
- ❌ Real-time sync across devices (in-memory only)
- ❌ AI features (requires `VITE_GEMINI_API_KEY`)
- ❌ Push notifications (requires FCM setup)
- ❌ Data persistence (cleared on browser restart)

**What DOES work:**
- ✅ All UI components and pages
- ✅ All CRUD operations (in-memory)
- ✅ Navigation and routing
- ✅ Habit tracking, points, streaks
- ✅ Budget calculations
- ✅ Safe-to-spend calculations
- ✅ Form validation and error handling

### Deactivating Test Mode

Test mode automatically ends when:
- Browser tab/window is closed
- User clicks "Sign Out"
- Navigate to `/login` without `?test=true` parameter

Or manually via browser console:
```javascript
sessionStorage.removeItem('LIFEBALANCE_TEST_MODE');
window.location.reload();
```

## Production Safety

Test mode is **100% excluded from production**:
- ✅ Requires `NODE_ENV=development`
- ✅ Requires `VITE_ENABLE_TEST_MODE=true` in `.env.local`
- ✅ Mock code tree-shaken from production builds
- ✅ Session-only persistence

Verify by building:
```bash
npm run build
grep -r "MockAuthProvider" dist/  # Should return nothing
```

## Troubleshooting

**Port 3000 already in use:**
```bash
# Kill existing process
lsof -ti:3000 | xargs kill -9

# Then restart
npm run dev
```

**Test mode not activating:**
1. Check `.env.local` contains `VITE_ENABLE_TEST_MODE=true`
2. Restart dev server (`Ctrl+C` then `npm run dev`)
3. Ensure URL includes `?test=true` parameter
4. Check browser console for errors

**Changes not appearing:**
1. Check terminal for build errors
2. Hard refresh browser (`Ctrl+Shift+R` or `Cmd+Shift+R`)
3. Clear browser cache

## Need Help?

**Documentation:**
- [CLAUDE.md](CLAUDE.md) - Complete project documentation
- [README.md](README.md) - Project overview
- [types/schema.ts](types/schema.ts) - All data models

**Key Files to Understand:**
- [contexts/FirebaseHouseholdContext.tsx](contexts/FirebaseHouseholdContext.tsx) - Main state management
- [App.tsx](App.tsx) - Routing and test mode activation
- [pages/Dashboard.tsx](pages/Dashboard.tsx) - Example page structure

---

**Happy exploring! 🚀**

If you have questions or find issues, check the inline code comments or explore the well-documented [CLAUDE.md](CLAUDE.md) file.
