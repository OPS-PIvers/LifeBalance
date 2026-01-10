# Push Notifications Setup & Deployment Guide

This guide covers the complete push notification system for LifeBalance, including setup, deployment, and customization.

## Overview

LifeBalance includes a comprehensive notification system with:
- **Habit Reminders**: Daily check-ins to complete habits
- **Action Queue Reminders**: Morning summary of today's tasks
- **Budget Alerts**: Warnings when safe-to-spend drops below threshold
- **Streak Warnings**: Alerts before habit streaks break
- **Bill Reminders**: Upcoming bill payment notifications

All notifications are **individually toggleable** with **customizable times** per user.

## Prerequisites

1. **Firebase Project** with:
   - Firestore Database
   - Firebase Authentication
   - Firebase Cloud Messaging (FCM)
   - Firebase Cloud Functions enabled (Blaze plan required)

2. **Firebase CLI** installed:
   ```bash
   npm install -g firebase-tools
   ```

3. **VAPID Key** configured (already done):
   - Located in `.env.local` as `VITE_FIREBASE_VAPID_KEY`
   - GitHub Secret created for deployments

## Project Structure

```
/
├── functions/                    # Backend Cloud Functions
│   ├── src/
│   │   └── index.ts             # All notification functions
│   ├── package.json
│   └── tsconfig.json
├── components/
│   └── settings/
│       └── NotificationSettings.tsx  # UI for preferences
├── pages/
│   └── Settings.tsx             # Main settings page
├── services/
│   └── notificationService.ts   # Client-side notification handling
├── public/
│   └── sw.js                    # Service worker for background notifications
└── types/
    └── schema.ts                # NotificationPreferences interface
```

## User Flow

### 1. Enable Notifications (Client)

Users enable notifications in Settings:
1. Click "Enable Notifications" button
2. Browser requests permission
3. FCM token is generated and saved to Firestore
4. Notification preferences panel appears

### 2. Configure Preferences (Client)

Users customize their notification settings:
- Toggle each notification type on/off
- Set custom times for scheduled notifications
- Set thresholds for budget alerts
- Choose how many days before bills to be reminded

All preferences are saved to Firestore under `households/{id}/members[].notificationPreferences`

### 3. Cloud Functions Send Notifications (Backend)

Firebase Cloud Functions run on schedules:
- Check user preferences every hour
- Send notifications at configured times
- Handle FCM token management
- Clean up invalid tokens automatically

## Deployment Steps

### 1. Build Cloud Functions

```bash
cd functions
npm install
npm run build
```

### 2. Deploy Functions to Firebase

```bash
# Deploy all functions
npm run deploy

# Or deploy individual functions
firebase deploy --only functions:sendHabitReminders
firebase deploy --only functions:sendActionQueueReminders
firebase deploy --only functions:sendStreakWarnings
firebase deploy --only functions:sendBillReminders
firebase deploy --only functions:sendBudgetAlerts
```

### 3. Verify Deployment

Check the Firebase Console:
1. Go to **Functions** section
2. Verify all 5 functions are deployed:
   - `sendHabitReminders` (scheduled hourly)
   - `sendActionQueueReminders` (scheduled hourly)
   - `sendStreakWarnings` (scheduled hourly)
   - `sendBillReminders` (scheduled hourly)
   - `sendBudgetAlerts` (Firestore trigger)

### 4. Monitor Function Logs

```bash
# View all function logs
npm run logs

# View specific function logs
firebase functions:log --only sendHabitReminders

# Stream logs in real-time
firebase functions:log --follow
```

## Environment Configuration

### Required Environment Variables

**Client-side** (`.env.local`):
```bash
VITE_FIREBASE_VAPID_KEY=your_vapid_key_here
```

**Cloud Functions** (Set in Firebase Console):
```bash
# Currently none required - uses default Firebase credentials
# If you need custom config:
firebase functions:config:set someservice.key="THE API KEY"
```

## Notification Types

### 1. Habit Reminders
- **Trigger**: Scheduled (hourly check)
- **Condition**: User's configured time matches
- **Message**: "Time for your daily habit check-in! 🎯"
- **Link**: `/habits`

### 2. Action Queue Reminders
- **Trigger**: Scheduled (hourly check)
- **Condition**: User has incomplete todos for today
- **Message**: "Good morning! You have X tasks today"
- **Link**: `/dashboard`

### 3. Streak Warnings
- **Trigger**: Scheduled (hourly check)
- **Condition**: User has habits with 3+ day streaks not completed today
- **Message**: "Don't break your streak! 🔥"
- **Link**: `/habits`

### 4. Bill Reminders
- **Trigger**: Scheduled (hourly check)
- **Condition**: Bills due in X days (user-configured)
- **Message**: "Bills due in X days - $Y.YY total"
- **Link**: `/budget`

### 5. Budget Alerts
- **Trigger**: Firestore update (real-time)
- **Condition**: Safe-to-spend drops below threshold
- **Message**: "Low Balance Alert! 💰"
- **Link**: `/budget`

## Testing

### Local Testing with Emulators

```bash
cd functions
npm run serve
```

This starts Firebase emulators for local testing.

### Manual Testing

1. **Enable notifications** in your app's Settings
2. **Set a notification time** to 1 minute from now
3. **Wait for the scheduled function** to run (hourly)
4. **Check function logs** for execution

### Force Test (Development)

Temporarily modify the schedule in `functions/src/index.ts`:
```typescript
// Change from:
.schedule("every 1 hours")

// To:
.schedule("every 1 minutes")
```

**Remember to change it back before deploying to production!**

## Timezone Handling

Currently, the system uses a simplified timezone approach:
- Times are stored in HH:MM format (24-hour)
- Functions run in UTC
- Basic time matching logic

### Future Improvement
For production, consider:
- Storing user timezone in preferences
- Using libraries like `date-fns-tz` or `luxon`
- Converting scheduled times to UTC before comparison

## Cost Considerations

### Cloud Functions Pricing (Blaze Plan)
- **Invocations**: First 2 million free per month
- **Compute time**: First 400,000 GB-seconds free
- **Network egress**: First 5GB free

### Estimated Usage
With 100 users:
- ~720 invocations/day (4 scheduled functions × hourly × 24 + budget triggers)
- ~$0.01 - $0.05 per day
- ~$0.30 - $1.50 per month

With 1000 users:
- Still within free tier for invocations
- ~$1 - $5 per month

## Troubleshooting

### Notifications Not Received

1. **Check browser permission**:
   - Settings → Notifications should show "Enabled"
   - Browser settings must allow notifications

2. **Verify FCM token**:
   - Check Firestore: `households/{id}/members[].fcmTokens`
   - Should contain at least one token

3. **Check function logs**:
   ```bash
   firebase functions:log --only sendHabitReminders
   ```

4. **Verify function is running**:
   - Firebase Console → Functions
   - Check last execution time

### Invalid Token Errors

Cloud Functions automatically remove invalid tokens. If you see these errors:
- User may have revoked permissions
- Token expired (FCM tokens refresh automatically)
- User uninstalled/cleared browser data

### Notifications Send at Wrong Time

- Check user's timezone preference
- Verify system clock on device
- Remember: Functions run in UTC

## Security

### Firestore Rules

Ensure your `firestore.rules` allow:
```javascript
// Users can update their own notification preferences
match /households/{householdId} {
  allow read, write: if request.auth != null &&
    request.auth.uid in resource.data.members.map(m => m.uid);
}
```

### FCM Token Security

- Tokens are stored in Firestore (user-specific)
- Only household members can read tokens
- Cloud Functions use Admin SDK (bypasses rules)

## Future Enhancements

### Potential Additions

1. **Challenge Notifications**:
   - When you complete a challenge
   - When friends complete challenges
   - Monthly challenge reminders

2. **Social Features**:
   - Household member achievements
   - Reward redemptions
   - Points milestones

3. **Smart Timing**:
   - Learn optimal notification times
   - Batch multiple notifications
   - Quiet hours

4. **Rich Notifications**:
   - Action buttons (complete habit directly)
   - Images and progress bars
   - Inline replies

5. **Multi-channel**:
   - Email digests
   - SMS for critical alerts
   - Telegram integration (already in schema!)

## Support

### Common Issues

**"Notifications denied in browser"**
- User must manually re-enable in browser settings
- Chrome: Settings → Privacy → Site Settings → Notifications
- Safari: Preferences → Websites → Notifications

**"Functions not deploying"**
- Ensure Blaze plan enabled
- Check billing account status
- Verify Firebase CLI is logged in: `firebase login`

**"High cloud function costs"**
- Review function execution logs
- Check for infinite loops
- Optimize Firestore queries
- Consider batching notifications

### Getting Help

1. Check Firebase Console logs
2. Review browser console for client errors
3. Test with Firebase Emulators locally
4. Check Firebase Status: https://status.firebase.google.com/

## License

This notification system is part of LifeBalance and follows the project's license.
