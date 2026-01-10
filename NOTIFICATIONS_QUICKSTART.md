# Push Notifications - Quick Start Guide

Get your LifeBalance notifications up and running in 5 minutes!

## ✅ Prerequisites Complete

You've already completed:
- ✅ VAPID key generated and added to `.env.local`
- ✅ GitHub secret created for CI/CD
- ✅ Cloud Functions code written
- ✅ UI components created

## 🚀 Deploy in 3 Steps

### Step 1: Build the Functions

```bash
cd functions
npm install
npm run build
```

### Step 2: Deploy to Firebase

```bash
# Make sure you're logged in
firebase login

# Deploy everything (hosting + functions)
firebase deploy

# Or deploy just functions
firebase deploy --only functions
```

### Step 3: Test It Out!

1. Open your app: https://your-app.web.app
2. Go to **Settings**
3. Click **"Enable Push Notifications"**
4. Toggle on the notifications you want
5. Set your preferred times
6. Click **"Save Preferences"**

## 📱 What You Get

### 5 Smart Notifications:

1. **🎯 Habit Reminders** - Daily check-in at your chosen time
2. **📝 Morning To-Do List** - Start your day with today's tasks
3. **💰 Low Balance Alerts** - When your safe-to-spend gets low
4. **🔥 Streak Protection** - Don't break that habit streak!
5. **📅 Bill Reminders** - Never miss a payment

## ⚙️ How It Works

```
User Enables Notifications
    ↓
FCM Token Saved to Firestore
    ↓
User Configures Preferences
    ↓
Cloud Functions Check Hourly
    ↓
Notifications Sent at Scheduled Times
```

## 🧪 Testing

### Quick Test (1 minute):
1. Set a habit reminder for 1 minute from now
2. Wait for the next hour (functions run hourly)
3. Check Firebase logs: `firebase functions:log`

### Immediate Test (Development):
Temporarily edit `functions/src/index.ts`:
```typescript
// Change schedule from hourly to every minute
.schedule("every 1 minutes")
```
Deploy, test, then change it back!

## 📊 Monitor Your Functions

```bash
# View logs
firebase functions:log

# Stream live logs
firebase functions:log --follow

# Check specific function
firebase functions:log --only sendHabitReminders
```

## 💡 Pro Tips

### Customize Times
Each user can set their own notification times - perfect for households with different schedules!

### Timezone Aware
Set your timezone in notification preferences for accurate scheduling.

### Battery Friendly
Functions only run when needed - no constant polling!

## 🐛 Troubleshooting

**Not receiving notifications?**
1. Check browser permissions (must be "Allow")
2. Verify FCM token in Firestore
3. Check function logs for errors
4. Ensure notifications are toggled ON in settings

**Functions not deploying?**
1. Ensure Firebase Blaze plan is enabled
2. Run `firebase login` to re-authenticate
3. Check billing status in Firebase Console

**Wrong notification times?**
- Verify your timezone is set correctly
- Functions run in UTC - times are converted

## 💰 Cost Estimate

With typical usage:
- **0-100 users**: FREE (within free tier)
- **100-1000 users**: ~$1-5/month
- **1000+ users**: ~$5-20/month

## 📚 Full Documentation

For complete details, see [NOTIFICATIONS.md](./NOTIFICATIONS.md)

## 🎉 You're Done!

Your notification system is ready to go. Users can now stay on top of their habits, tasks, and finances with timely, personalized alerts!

---

**Need help?** Check the logs, review the full documentation, or open an issue on GitHub.
