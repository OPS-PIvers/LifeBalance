# LifeBalance Cloud Functions

Firebase Cloud Functions for LifeBalance push notifications system.

## Overview

This directory contains the backend Cloud Functions that power the LifeBalance notification system. Functions run automatically on schedules and triggers to send timely, personalized notifications to users.

## Functions

### Scheduled Functions (Run Hourly)

1. **sendhabitreminders**
   - Checks if it's time to send habit reminders based on user preferences
   - Sends notifications to remind users to complete their daily habits

2. **sendactionqueuereminders**
   - Sends morning reminders about today's to-do items
   - Only sends if user has incomplete tasks for the day

3. **sendstreakwarnings**
   - Warns users before their habit streaks break
   - Only alerts for habits with 3+ day streaks

4. **sendbillreminders**
   - Reminds users about upcoming bill payments
   - Checks based on user-configured days-before-due setting

### Triggered Functions

5. **sendbudgetalerts**
   - Firestore trigger on household document updates
   - Sends alert when safe-to-spend drops below user threshold

## Development

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Watch mode
npm run build:watch

# Test locally with emulators
npm run serve
```

## Deployment

```bash
# Deploy all functions
npm run deploy

# Deploy specific function
firebase deploy --only functions:sendhabitreminders

# View logs
npm run logs
```

## Structure

```
functions/
├── src/
│   └── index.ts          # All notification functions
├── lib/                  # Compiled JavaScript (git-ignored)
├── package.json
├── tsconfig.json
└── README.md            # This file
```

## Configuration

### Runtime
- Node.js 18
- Firebase Functions v2 API
- TypeScript

### Permissions
Functions use Firebase Admin SDK with automatic service account credentials.

### Environment
No environment variables required - uses default Firebase project configuration.

## How It Works

### 1. Scheduled Functions
- Run every hour via Cloud Scheduler
- Check all households and their members
- Compare current time with user's configured notification time
- Send FCM messages if time matches

### 2. Triggered Functions
- Listen for Firestore document changes
- Evaluate conditions (e.g., balance threshold)
- Send immediate notifications when triggered

### 3. FCM Token Management
- Automatically removes invalid tokens
- Logs token errors for debugging
- Handles multiple tokens per user (multi-device support)

## Testing

### Local Testing
```bash
npm run serve
```
This starts Firebase emulators on `localhost:5001`

### Production Testing
1. Deploy functions
2. Enable notifications in app
3. Set notification time to current time + 5 minutes
4. Wait for hourly trigger
5. Check logs: `firebase functions:log`

### Force Immediate Test
Temporarily change schedule:
```typescript
// In src/index.ts
onSchedule("every 1 minutes", async () => {
  // function code
});
```
Deploy, test, then revert to `"every 1 hours"`

## Monitoring

### View Logs
```bash
# All logs
firebase functions:log

# Specific function
firebase functions:log --only sendhabitreminders

# Live stream
firebase functions:log --follow
```

### Firebase Console
- Functions → sendhabitreminders → Logs tab
- View execution history, errors, and performance

## Cost

Estimated monthly costs:
- 0-100 users: FREE (within free tier)
- 100-1000 users: $1-5/month
- 1000+ users: $5-20/month

Free tier includes:
- 2M invocations/month
- 400,000 GB-seconds compute time

## Timezone Handling

Current implementation uses simplified UTC-based time matching. For production:

```typescript
// TODO: Implement proper timezone support
import { DateTime } from 'luxon';

function isTimeToSend(scheduledTime: string, timezone: string): boolean {
  const userTime = DateTime.now().setZone(timezone);
  const [hour, minute] = scheduledTime.split(':').map(Number);
  return userTime.hour === hour && userTime.minute === minute;
}
```

## Security

- Functions use Admin SDK (bypasses Firestore rules)
- Only sends to users with valid FCM tokens
- Respects user notification preferences
- Automatically cleans up invalid tokens

## Troubleshooting

### Functions Not Executing
1. Check Cloud Scheduler in Firebase Console
2. Verify Blaze plan is enabled
3. Check function deployment status
4. Review error logs

### Notifications Not Received
1. Verify user has FCM token in Firestore
2. Check notification preferences are enabled
3. Confirm browser permission is granted
4. Review function logs for errors

### High Costs
1. Review execution frequency in logs
2. Check for infinite loops or errors
3. Optimize Firestore queries
4. Consider batching notifications

## Future Enhancements

- [ ] Proper timezone support with luxon/date-fns-tz
- [ ] Batch notifications for efficiency
- [ ] Smart timing (learn optimal notification times)
- [ ] Rich notifications with action buttons
- [ ] Email fallback for critical alerts
- [ ] Multi-language support
- [ ] A/B testing for notification copy

## Support

For issues, check:
1. Firebase Console logs
2. Function deployment status
3. [NOTIFICATIONS.md](../NOTIFICATIONS.md) - Full documentation
4. [NOTIFICATIONS_QUICKSTART.md](../NOTIFICATIONS_QUICKSTART.md) - Quick setup

## License

Part of LifeBalance project.
