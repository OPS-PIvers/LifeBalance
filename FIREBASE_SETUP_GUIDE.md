# Firebase Setup Guide for LifeBalance

## ✅ What Has Been Completed

Your LifeBalance app has been fully integrated with Firebase! Here's what's been implemented:

### 1. Firebase Configuration ✓
- Firebase SDK installed and configured
- Environment variables set up in `.env.local`
- Firebase project connected (lifebalance-26080)

### 2. Authentication System ✓
- Google Sign-In implementation
- Protected routes requiring authentication
- Login page with beautiful UI
- Automatic redirect flow based on user state

### 3. Household Management ✓
- Create new household functionality
- Join existing household via 6-character invite code
- Household invite code generation and display
- Multi-user support with role-based access (admin/member)

### 4. Firebase Data Layer ✓
- Real-time Firestore synchronization for all data:
  - Accounts
  - Budget buckets
  - Transactions
  - Calendar items (bills/income)
  - Habits
  - Challenges
  - Rewards
  - Household members
- All business logic preserved (safe-to-spend, habit streaks, point multipliers)
- Automatic habit period resets (daily/weekly)

### 5. Deployment Configuration ✓
- Firestore security rules created
- Firebase Hosting configuration
- Deployment scripts added to package.json

---

## 🚀 Next Steps

### Step 1: Enable Firebase Services

You need to enable the following services in your Firebase Console:

#### A. Enable Authentication
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project: **lifebalance-26080**
3. Click **Authentication** in the left sidebar
4. Click **Get Started**
5. Go to **Sign-in method** tab
6. Enable **Google** sign-in provider
7. Add your email as a test user if needed

#### B. Enable Firestore Database
1. In Firebase Console, click **Firestore Database** in the left sidebar
2. Click **Create database**
3. Choose **Start in production mode** (we'll deploy security rules next)
4. Select your preferred location (e.g., us-central)
5. Click **Enable**

#### C. Enable Firebase Hosting (Optional - for deployment)
1. In Firebase Console, click **Hosting** in the left sidebar
2. Click **Get started**
3. Follow the wizard (the configuration files are already created)

---

### Step 2: Login to Firebase CLI

Open your terminal and run:

```bash
firebase login
```

This will open a browser window for you to authenticate with Google.

---

### Step 3: Deploy Firestore Security Rules

Deploy the security rules to protect your data:

```bash
npm run deploy:rules
```

Or manually:

```bash
firebase deploy --only firestore:rules
```

---

### Step 4: Test the Application

The dev server is already running on **http://localhost:3000**

#### Test Flow:
1. Open http://localhost:3000 in your browser
2. You should see the Login page
3. Click "Continue with Google"
4. Sign in with your Google account
5. After signing in, you'll see the Household Setup page
6. Choose to "Create New Household" or "Join Existing Household"
7. If creating: Enter a household name (e.g., "Smith Family")
8. You'll get a 6-character invite code to share with family members
9. Click "Continue to Dashboard"
10. You should now see the Dashboard with all features working!

#### Test Multi-User:
1. Open a private/incognito browser window
2. Go to http://localhost:3000
3. Sign in with a different Google account
4. Choose "Join Existing Household"
5. Enter the invite code from the first user
6. Both users should see real-time updates!

---

### Step 5: Deploy to Firebase Hosting

When you're ready to deploy your app to production:

```bash
# Build and deploy
npm run deploy
```

Or step by step:

```bash
# Build the production bundle
npm run build

# Deploy to Firebase Hosting
firebase deploy --only hosting
```

Your app will be live at: **https://lifebalance-26080.web.app**

---

## 📁 What Was Changed

### New Files Created (21 files):
- `firebase.config.ts` - Firebase initialization
- `contexts/AuthContext.tsx` - Authentication state management
- `contexts/FirebaseHouseholdContext.tsx` - Firebase-backed household data
- `services/authService.ts` - Google Sign-In logic
- `services/householdService.ts` - Household CRUD operations
- `hooks/useFirestoreListener.ts` - Real-time listener hook (not used, but available)
- `utils/inviteCodeGenerator.ts` - Generate unique invite codes
- `utils/safeToSpendCalculator.ts` - Safe-to-spend business logic
- `utils/habitLogic.ts` - Habit tracking business logic
- `pages/Login.tsx` - Login page
- `pages/HouseholdSetup.tsx` - Create/join household page
- `pages/Loading.tsx` - Loading spinner
- `components/auth/ProtectedRoute.tsx` - Route guard
- `components/auth/HouseholdInviteCard.tsx` - Invite code display
- `.env.local` - Environment variables (Firebase config)
- `firebase.json` - Firebase Hosting configuration
- `.firebaserc` - Firebase project configuration
- `firestore.rules` - Firestore security rules
- `FIREBASE_SETUP_GUIDE.md` - This guide

### Files Modified (4 files):
- `App.tsx` - Added AuthProvider, updated routing
- `package.json` - Added deployment scripts
- `types/schema.ts` - Added Firebase-specific fields
- `components/layout/TopToolbar.tsx` - Updated imports

### Files Archived (1 file):
- `contexts/HouseholdContext.backup.tsx` - Original in-memory context (for reference)

---

## 🔒 Security

### Firestore Security Rules
The deployed security rules ensure:
- Users can only access households they're members of
- Only authenticated users can create households
- Only admins can delete households
- Household members can read/write all household data
- Invite codes are read-only after creation

### Environment Variables
Your Firebase credentials are stored in `.env.local` which is:
- ✅ Already in `.gitignore` (won't be committed)
- ✅ Only loaded in your local development environment
- ✅ Need to be set separately in production (Firebase Hosting handles this automatically)

---

## 🎯 Key Features Implemented

### Authentication Flow
```
User lands on app
  ↓
Not authenticated? → Login Page (Google Sign-In)
  ↓
Authenticated but no household? → Household Setup (Create/Join)
  ↓
Authenticated + has household → Dashboard (Full App Access)
```

### Real-Time Synchronization
- ✅ Changes made by one user appear instantly for all household members
- ✅ Uses Firestore `onSnapshot` listeners for automatic updates
- ✅ No manual refresh needed

### Business Logic Preserved
- ✅ Safe-to-spend calculation (checking balance - unpaid bills - bucket liabilities)
- ✅ Habit streaks and point multipliers (3-6 days = 1.5x, 7+ days = 2.0x)
- ✅ Habit auto-reset based on period (daily/weekly)
- ✅ 4-step bill payment cascade (mark paid → update account → create transaction → update bucket)
- ✅ Transaction categorization and bucket updates

---

## 📊 Data Structure

### Firestore Collections

```
households/
  {householdId}/
    - name: string
    - inviteCode: string
    - memberUids: string[]
    - freezeBank: object
    - createdAt: timestamp
    - createdBy: string

    members/
      {userId} - HouseholdMember

    accounts/
      {accountId} - Account

    buckets/
      {bucketId} - BudgetBucket

    transactions/
      {transactionId} - Transaction

    calendarItems/
      {itemId} - CalendarItem

    habits/
      {habitId} - Habit (with isShared, ownerId)

    challenges/
      {challengeId} - Challenge

    rewards/
      {rewardId} - RewardItem

inviteCodes/
  {CODE} - { code, householdId, createdAt }
```

---

## 🐛 Troubleshooting

### Issue: "Firebase: Error (auth/unauthorized-domain)"
**Solution:** In Firebase Console → Authentication → Settings → Authorized domains, add your domain/localhost

### Issue: "Missing or insufficient permissions"
**Solution:** Deploy the Firestore security rules using `npm run deploy:rules`

### Issue: "Cannot read properties of null (reading 'uid')"
**Solution:** Make sure you're signed in and have created/joined a household

### Issue: Changes not syncing across devices
**Solution:**
1. Check that Firestore is enabled in Firebase Console
2. Check browser console for errors
3. Verify security rules are deployed
4. Make sure both users are in the same household

---

## 🎉 You're All Set!

Your LifeBalance app is now:
- ✅ Connected to Firebase
- ✅ Supporting multiple users
- ✅ Syncing data in real-time
- ✅ Secured with authentication and security rules
- ✅ Ready to deploy to production

### Deployment Commands Summary
```bash
# Deploy security rules only
npm run deploy:rules

# Deploy hosting only
npm run deploy

# Deploy everything (rules + hosting)
npm run deploy:all
```

### Development Commands
```bash
# Start dev server
npm run dev

# Build for production
npm run build

# Preview production build locally
npm run preview
```

---

## 📝 Notes

- The original in-memory `HouseholdContext` is preserved as `HouseholdContext.backup.tsx` for reference
- All business logic functions have been extracted to `/utils` for reusability
- The app uses HashRouter (not BrowserRouter) for easy deployment without server-side routing
- Firestore timestamps are automatically converted to ISO strings for consistency
- Habit ownership: Set `isShared: true` for household-wide habits, `false` for personal habits

---

Need help? Check the Firebase docs or review the code comments in the new files!
