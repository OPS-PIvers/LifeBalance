import React, { useState } from 'react';
import { Clock, DollarSign, Flame, Calendar, ListTodo, Send, Info, Newspaper } from 'lucide-react';
import { NotificationPreferences } from '@/types/schema';
import toast from 'react-hot-toast';
import { getFunctionsInstance } from '@/firebase.config';
import { isIOSDevice, isPWA, supportsPush } from '@/utils/platform';
import { SurfaceList, Row } from '@/components/ui/Section';
import { Switch } from '@/components/ui/Switch';
import { Button } from '@/components/ui/Button';

interface NotificationSettingsProps {
  userId?: string;
  householdId: string;
  currentPreferences?: NotificationPreferences;
  onSave: (preferences: NotificationPreferences) => Promise<void>;
}

const DEFAULT_PREFERENCES: NotificationPreferences = {
  habitReminders: {
    enabled: false,
    time: '20:00'
  },
  actionQueueReminders: {
    enabled: false,
    time: '08:00'
  },
  budgetAlerts: {
    enabled: false,
    threshold: 100
  },
  streakWarnings: {
    enabled: false,
    time: '21:00'
  },
  billReminders: {
    enabled: false,
    daysBeforeDue: 1,
    time: '09:00'
  },
  // Weekly recap defaults ON — a fixed Sunday-evening send (no time selection),
  // so the switch is the only control.
  weeklyRecap: {
    enabled: true
  },
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
};

// Shared input styling for the inline time/number controls inside each
// preference row. Solid surface + hairline border + evergreen focus ring, no
// glass/gradient — matches the redesigned Select/input language.
const inlineControlClass =
  'text-base sm:text-sm px-3 py-1.5 border border-brand-200 dark:border-brand-700 rounded-btn bg-white dark:bg-brand-900 text-brand-900 dark:text-brand-100 outline-hidden focus:border-accent-500 focus:ring-2 focus:ring-accent-500/30 transition-all duration-(--duration-fast) ease-(--ease-standard)';

const getHourOptions = () => {
  return Array.from({ length: 24 }, (_, i) => {
    const hour = i;
    const period = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    const value = `${hour.toString().padStart(2, '0')}:00`;
    const label = `${displayHour}:00 ${period}`;
    return { value, label };
  });
};

// Merge saved preferences over the defaults one section at a time. Legacy
// Firestore docs can predate newer sections (e.g. billReminders), and a
// shallow spread of such a doc would leave those sections undefined and crash
// the render on `.enabled`. Also falls back to the browser timezone so
// existing users don't silently default to UTC.
const mergePreferences = (current?: NotificationPreferences): NotificationPreferences => ({
  habitReminders: { ...DEFAULT_PREFERENCES.habitReminders, ...current?.habitReminders },
  actionQueueReminders: { ...DEFAULT_PREFERENCES.actionQueueReminders, ...current?.actionQueueReminders },
  budgetAlerts: { ...DEFAULT_PREFERENCES.budgetAlerts, ...current?.budgetAlerts },
  streakWarnings: { ...DEFAULT_PREFERENCES.streakWarnings, ...current?.streakWarnings },
  billReminders: { ...DEFAULT_PREFERENCES.billReminders, ...current?.billReminders },
  weeklyRecap: { enabled: true, ...current?.weeklyRecap },
  timezone: current?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone
});

const NotificationSettings: React.FC<NotificationSettingsProps> = ({
  householdId,
  currentPreferences,
  onSave
}) => {
  const [preferences, setPreferences] = useState<NotificationPreferences>(() =>
    mergePreferences(currentPreferences)
  );
  const [isSaving, setIsSaving] = useState(false);

  const hourOptions = getHourOptions();

  // Sync local preferences when the saved preferences prop changes. Done during
  // render on that change edge rather than in an effect so it doesn't trigger a
  // cascading render. Mirrors the previous effect keyed on `[currentPreferences]`
  // (which fully replaced local state from the prop, ignoring the previous value).
  const [prevCurrentPreferences, setPrevCurrentPreferences] = useState(currentPreferences);
  if (prevCurrentPreferences !== currentPreferences) {
    setPrevCurrentPreferences(currentPreferences);
    if (currentPreferences) {
      setPreferences(mergePreferences(currentPreferences));
    }
  }

  const handleToggle = (key: keyof NotificationPreferences) => {
    setPreferences(prev => {
      const currentValue = prev[key];
      if (typeof currentValue === 'object' && currentValue !== null && 'enabled' in currentValue) {
        return {
          ...prev,
          [key]: {
            ...currentValue,
            enabled: !currentValue.enabled
          }
        };
      }
      return prev;
    });
  };

  const handleTimeChange = (key: keyof NotificationPreferences, time: string) => {
    setPreferences(prev => {
      const currentValue = prev[key];
      if (typeof currentValue === 'object' && currentValue !== null && 'time' in currentValue) {
        return {
          ...prev,
          [key]: {
            ...currentValue,
            time
          }
        };
      }
      return prev;
    });
  };

  const handleThresholdChange = (threshold: number) => {
    setPreferences(prev => ({
      ...prev,
      budgetAlerts: {
        ...prev.budgetAlerts,
        threshold
      }
    }));
  };

  const handleDaysBeforeChange = (days: number) => {
    setPreferences(prev => ({
      ...prev,
      billReminders: {
        ...prev.billReminders,
        daysBeforeDue: days
      }
    }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave(preferences);
      toast.success('Notification preferences saved');
    } catch (error) {
      console.error('Error saving preferences:', error);
      toast.error('Failed to save preferences');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSendTest = async () => {
    const toastId = toast.loading('Sending test notification...');
    try {
      const [{ httpsCallable }, functions] = await Promise.all([
        import('firebase/functions'),
        getFunctionsInstance(),
      ]);
      const sendTest = httpsCallable(functions, 'sendtestnotification');

      await sendTest({ householdId });

      toast.success('Test notification sent! Check your device.', { id: toastId });
    } catch (error) {
      console.error('Error sending test notification:', error);
      toast.error('Failed to send test notification', { id: toastId });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          variant="subtle"
          size="sm"
          onClick={handleSendTest}
          leftIcon={<Send className="w-4 h-4" />}
          title="Send a test notification to your device"
        >
          Send test
        </Button>
      </div>

      {/* iOS-specific notice - a plain callout (icon + text), no boxed chrome */}
      {(() => {
        const isIOS = isIOSDevice();
        if (!isIOS) return null;

        const isPwa = isPWA();
        const hasPushSupport = supportsPush();
        const isReady = isPwa && hasPushSupport;

        return (
          <div className="flex items-start gap-3 px-1">
            <Info className={`w-5 h-5 shrink-0 mt-0.5 ${
              isReady ? 'text-money-pos dark:text-accent-300' : 'text-warm-600 dark:text-warm-300'
            }`} />
            <div>
              <h4 className={`font-semibold text-sm ${
                isReady ? 'text-accent-800 dark:text-accent-200' : 'text-warm-800 dark:text-warm-200'
              }`}>
                {isReady ? 'Push Notifications Ready' : 'iOS Notification Setup'}
              </h4>
              <p className={`text-sm mt-1 ${
                isReady ? 'text-accent-700 dark:text-accent-300' : 'text-warm-700 dark:text-warm-300'
              }`}>
                {isReady ? (
                  <>
                    Background notifications are enabled. You&apos;ll receive alerts even when
                    the app is closed.
                  </>
                ) : isPwa ? (
                  <>
                    Notifications will appear when the app is open.
                    For background notifications, ensure you&apos;re on iOS 16.4 or later.
                  </>
                ) : (
                  <>
                    To enable notifications, add LifeBalance to your Home Screen first.
                    Tap <strong>Share</strong> → <strong>Add to Home Screen</strong>, then open from there.
                  </>
                )}
              </p>
            </div>
          </div>
        );
      })()}

      <SurfaceList>
        {/* Habit Reminders */}
        <Row className="items-start">
          <div className="w-10 h-10 bg-warm-50 dark:bg-warm-500/15 rounded-btn flex items-center justify-center shrink-0">
            <Flame className="w-5 h-5 text-warm-600 dark:text-warm-300" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <h4 className="font-semibold text-brand-900 dark:text-brand-100">Daily Habit Check-In</h4>
                <p className="text-sm text-brand-500 dark:text-brand-400 mt-0.5">Remind me to complete my habits</p>
              </div>
              <Switch
                id="notif-habit-reminders"
                aria-label="Daily habit check-in reminders"
                checked={preferences.habitReminders.enabled}
                onCheckedChange={() => handleToggle('habitReminders')}
              />
            </div>
            {preferences.habitReminders.enabled && (
              <div className="flex items-center gap-2 mt-3">
                <Clock className="w-4 h-4 text-brand-500 dark:text-brand-400" />
                <select
                  value={preferences.habitReminders.time}
                  onChange={(e) => handleTimeChange('habitReminders', e.target.value)}
                  className={inlineControlClass}
                  aria-label="Habit reminder time"
                >
                  {hourOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </Row>

        {/* Action Queue Reminders */}
        <Row className="items-start">
          <div className="w-10 h-10 bg-habit-blue/15 rounded-btn flex items-center justify-center shrink-0">
            <ListTodo className="w-5 h-5 text-habit-blue" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <h4 className="font-semibold text-brand-900 dark:text-brand-100">Morning To-Do List</h4>
                <p className="text-sm text-brand-500 dark:text-brand-400 mt-0.5">Get reminders for pending to-dos, due bills, and incomplete habits each morning.</p>
              </div>
              <Switch
                id="notif-action-queue-reminders"
                aria-label="Morning to-do list reminders"
                checked={preferences.actionQueueReminders.enabled}
                onCheckedChange={() => handleToggle('actionQueueReminders')}
              />
            </div>
            {preferences.actionQueueReminders.enabled && (
              <div className="flex items-center gap-2 mt-3">
                <Clock className="w-4 h-4 text-brand-500 dark:text-brand-400" />
                <select
                  value={preferences.actionQueueReminders.time}
                  onChange={(e) => handleTimeChange('actionQueueReminders', e.target.value)}
                  className={inlineControlClass}
                  aria-label="Morning to-do reminder time"
                >
                  {hourOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </Row>

        {/* Budget Alerts */}
        <Row className="items-start">
          <div className="w-10 h-10 bg-money-bgNeg dark:bg-money-neg/15 rounded-btn flex items-center justify-center shrink-0">
            <DollarSign className="w-5 h-5 text-money-neg dark:text-money-negDark" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <h4 className="font-semibold text-brand-900 dark:text-brand-100">Low Balance Alert</h4>
                <p className="text-sm text-brand-500 dark:text-brand-400 mt-0.5">Alert when your Safe to Spend balance drops below your threshold.</p>
              </div>
              <Switch
                id="notif-budget-alerts"
                aria-label="Low balance alerts"
                checked={preferences.budgetAlerts.enabled}
                onCheckedChange={() => handleToggle('budgetAlerts')}
              />
            </div>
            {preferences.budgetAlerts.enabled && (
              <div className="flex items-center gap-2 mt-3">
                <span className="text-sm text-brand-600 dark:text-brand-300">Threshold:</span>
                <div className="flex items-center gap-1">
                  <span className="text-sm text-brand-500 dark:text-brand-400">$</span>
                  <input
                    type="number"
                    min="0"
                    step="10"
                    value={preferences.budgetAlerts.threshold ?? 100}
                    onChange={(e) => handleThresholdChange(Number(e.target.value))}
                    className={`w-20 ${inlineControlClass}`}
                    aria-label="Low balance alert threshold in dollars"
                  />
                </div>
              </div>
            )}
          </div>
        </Row>

        {/* Streak Warnings */}
        <Row className="items-start">
          <div className="w-10 h-10 bg-habit-streak/15 rounded-btn flex items-center justify-center shrink-0">
            <Flame className="w-5 h-5 text-habit-streak" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <h4 className="font-semibold text-brand-900 dark:text-brand-100">Streak Protection</h4>
                <p className="text-sm text-brand-500 dark:text-brand-400 mt-0.5">Remind me before my streak breaks</p>
              </div>
              <Switch
                id="notif-streak-warnings"
                aria-label="Streak protection reminders"
                checked={preferences.streakWarnings.enabled}
                onCheckedChange={() => handleToggle('streakWarnings')}
              />
            </div>
            {preferences.streakWarnings.enabled && (
              <div className="flex items-center gap-2 mt-3">
                <Clock className="w-4 h-4 text-brand-500 dark:text-brand-400" />
                <select
                  value={preferences.streakWarnings.time}
                  onChange={(e) => handleTimeChange('streakWarnings', e.target.value)}
                  className={inlineControlClass}
                  aria-label="Streak warning time"
                >
                  {hourOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </Row>

        {/* Bill Reminders */}
        <Row className="items-start">
          <div className="w-10 h-10 bg-accent-50 dark:bg-accent-500/15 rounded-btn flex items-center justify-center shrink-0">
            <Calendar className="w-5 h-5 text-accent-600 dark:text-accent-300" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <h4 className="font-semibold text-brand-900 dark:text-brand-100">Bill Payment Reminders</h4>
                <p className="text-sm text-brand-500 dark:text-brand-400 mt-0.5">Remind me about upcoming bills</p>
              </div>
              <Switch
                id="notif-bill-reminders"
                aria-label="Bill payment reminders"
                checked={preferences.billReminders.enabled}
                onCheckedChange={() => handleToggle('billReminders')}
              />
            </div>
            {preferences.billReminders.enabled && (
              <div className="mt-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-brand-600 dark:text-brand-300">Remind:</span>
                  <input
                    type="number"
                    min="1"
                    max="7"
                    value={preferences.billReminders.daysBeforeDue}
                    onChange={(e) => handleDaysBeforeChange(Number(e.target.value))}
                    className={`w-16 ${inlineControlClass}`}
                    aria-label="Days before bill due"
                  />
                  <span className="text-sm text-brand-500 dark:text-brand-400">day(s) before due</span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-brand-500 dark:text-brand-400" />
                  <select
                    value={preferences.billReminders.time}
                    onChange={(e) => handleTimeChange('billReminders', e.target.value)}
                    className={inlineControlClass}
                    aria-label="Bill reminder time"
                  >
                    {hourOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>
        </Row>

        {/* Weekly Recap — fixed Sunday-evening send, so no time select */}
        <Row className="items-start">
          <div className="w-10 h-10 bg-accent-50 dark:bg-accent-500/15 rounded-btn flex items-center justify-center shrink-0">
            <Newspaper className="w-5 h-5 text-accent-600 dark:text-accent-300" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <h4 className="font-semibold text-brand-900 dark:text-brand-100">Weekly Recap</h4>
                <p className="text-sm text-brand-500 dark:text-brand-400 mt-0.5">Your week in review — spending, habits, and what&apos;s ahead. Arrives Sunday evening.</p>
              </div>
              <Switch
                id="notif-weekly-recap"
                aria-label="Weekly recap notifications"
                checked={preferences.weeklyRecap?.enabled ?? true}
                onCheckedChange={() => handleToggle('weeklyRecap')}
              />
            </div>
          </div>
        </Row>
      </SurfaceList>

      {/* Save Button */}
      <Button
        variant="primary"
        size="lg"
        onClick={handleSave}
        isLoading={isSaving}
        className="w-full"
      >
        Save Preferences
      </Button>
    </div>
  );
};

export default NotificationSettings;
