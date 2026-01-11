import React, { useState, useEffect } from 'react';
import { Bell, Clock, DollarSign, Flame, Calendar, ListTodo, Send, Info } from 'lucide-react';
import { NotificationPreferences } from '@/types/schema';
import { getFunctions, httpsCallable } from 'firebase/functions';
import toast from 'react-hot-toast';
import { isIOSDevice, isPWA, supportsPush } from '@/services/notificationService';
import Card from '@/components/ui/Card';

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
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
};

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

const NotificationSettings: React.FC<NotificationSettingsProps> = ({
  householdId,
  currentPreferences,
  onSave
}) => {
  const [preferences, setPreferences] = useState<NotificationPreferences>(
    currentPreferences || DEFAULT_PREFERENCES
  );
  const [isSaving, setIsSaving] = useState(false);

  const hourOptions = getHourOptions();

  useEffect(() => {
    if (currentPreferences) {
      setPreferences(currentPreferences);
    }
  }, [currentPreferences]);

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
      const functions = getFunctions();
      const sendTest = httpsCallable(functions, 'sendtestnotification');

      await sendTest({ householdId });

      toast.success('Test notification sent! Check your device.', { id: toastId });
    } catch (error) {
      console.error('Error sending test notification:', error);
      toast.error('Failed to send test notification', { id: toastId });
    }
  };

  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-brand-100 rounded-xl flex items-center justify-center">
            <Bell className="w-6 h-6 text-brand-600" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-brand-800">Notification Preferences</h3>
            <p className="text-sm text-brand-500">Customize your alerts</p>
          </div>
        </div>

        <button
          onClick={handleSendTest}
          className="flex items-center gap-2 px-3 py-1.5 bg-brand-50 hover:bg-brand-100 text-brand-700 text-sm font-medium rounded-lg transition-colors border border-brand-200"
          title="Send a test notification to your device"
        >
          <Send className="w-4 h-4" />
          <span className="hidden sm:inline">Test</span>
        </button>
      </div>

      {/* iOS-specific notice - show helpful guidance based on current state */}
      {(() => {
        const isIOS = isIOSDevice();
        if (!isIOS) return null;

        const isPwa = isPWA();
        const hasPushSupport = supportsPush();
        const isReady = isPwa && hasPushSupport;

        return (
          <div className={`p-4 rounded-xl border mb-4 ${
            isReady ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'
          }`}>
            <div className="flex items-start gap-3">
              <Info className={`w-5 h-5 flex-shrink-0 mt-0.5 ${
                isReady ? 'text-green-600' : 'text-amber-600'
              }`} />
              <div>
                <h4 className={`font-semibold text-sm ${
                  isReady ? 'text-green-800' : 'text-amber-800'
                }`}>
                  {isReady ? 'Push Notifications Ready' : 'iOS Notification Setup'}
                </h4>
                <p className={`text-sm mt-1 ${
                  isReady ? 'text-green-700' : 'text-amber-700'
                }`}>
                  {isReady ? (
                    <>
                      Background notifications are enabled. You'll receive alerts even when
                      the app is closed.
                    </>
                  ) : isPwa ? (
                    <>
                      Notifications will appear when the app is open.
                      For background notifications, ensure you're on iOS 16.4 or later.
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
          </div>
        );
      })()}

      <div className="space-y-4">
        {/* Habit Reminders */}
        <div className="p-4 bg-brand-50 rounded-xl border border-brand-100">
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-start gap-3 flex-1">
              <div className="w-10 h-10 bg-habit-green-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <Flame className="w-5 h-5 text-habit-green-600" />
              </div>
              <div className="flex-1">
                <h4 className="font-semibold text-brand-800">Daily Habit Check-In</h4>
                <p className="text-sm text-brand-500 mt-1">Remind me to complete my habits</p>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
              <input
                type="checkbox"
                checked={preferences.habitReminders.enabled}
                onChange={() => handleToggle('habitReminders')}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-brand-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-brand-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-600"></div>
            </label>
          </div>
          {preferences.habitReminders.enabled && (
            <div className="flex items-center gap-2 ml-13 pl-3 border-l-2 border-brand-200">
              <Clock className="w-4 h-4 text-brand-500" />
              <select
                value={preferences.habitReminders.time}
                onChange={(e) => handleTimeChange('habitReminders', e.target.value)}
                className="text-sm px-3 py-1.5 border border-brand-200 rounded-lg focus:ring-2 focus:ring-brand-400 focus:border-transparent bg-white"
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

        {/* Action Queue Reminders */}
        <div className="p-4 bg-brand-50 rounded-xl border border-brand-100">
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-start gap-3 flex-1">
              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <ListTodo className="w-5 h-5 text-blue-600" />
              </div>
              <div className="flex-1">
                <h4 className="font-semibold text-brand-800">Morning To-Do List</h4>
                <p className="text-sm text-brand-500 mt-1">Get a summary of today's tasks</p>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
              <input
                type="checkbox"
                checked={preferences.actionQueueReminders.enabled}
                onChange={() => handleToggle('actionQueueReminders')}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-brand-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-brand-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-600"></div>
            </label>
          </div>
          {preferences.actionQueueReminders.enabled && (
            <div className="flex items-center gap-2 ml-13 pl-3 border-l-2 border-brand-200">
              <Clock className="w-4 h-4 text-brand-500" />
              <select
                value={preferences.actionQueueReminders.time}
                onChange={(e) => handleTimeChange('actionQueueReminders', e.target.value)}
                className="text-sm px-3 py-1.5 border border-brand-200 rounded-lg focus:ring-2 focus:ring-brand-400 focus:border-transparent bg-white"
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

        {/* Budget Alerts */}
        <div className="p-4 bg-brand-50 rounded-xl border border-brand-100">
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-start gap-3 flex-1">
              <div className="w-10 h-10 bg-money-red-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <DollarSign className="w-5 h-5 text-money-red-600" />
              </div>
              <div className="flex-1">
                <h4 className="font-semibold text-brand-800">Low Balance Alert</h4>
                <p className="text-sm text-brand-500 mt-1">Alert when safe-to-spend is low</p>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
              <input
                type="checkbox"
                checked={preferences.budgetAlerts.enabled}
                onChange={() => handleToggle('budgetAlerts')}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-brand-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-brand-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-600"></div>
            </label>
          </div>
          {preferences.budgetAlerts.enabled && (
            <div className="flex items-center gap-2 ml-13 pl-3 border-l-2 border-brand-200">
              <span className="text-sm text-brand-600">Threshold:</span>
              <div className="flex items-center gap-1">
                <span className="text-sm text-brand-500">$</span>
                <input
                  type="number"
                  min="0"
                  step="10"
                  value={preferences.budgetAlerts.threshold || 100}
                  onChange={(e) => handleThresholdChange(Number(e.target.value))}
                  className="w-20 text-sm px-3 py-1.5 border border-brand-200 rounded-lg focus:ring-2 focus:ring-brand-400 focus:border-transparent"
                />
              </div>
            </div>
          )}
        </div>

        {/* Streak Warnings */}
        <div className="p-4 bg-brand-50 rounded-xl border border-brand-100">
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-start gap-3 flex-1">
              <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <Flame className="w-5 h-5 text-orange-600" />
              </div>
              <div className="flex-1">
                <h4 className="font-semibold text-brand-800">Streak Protection</h4>
                <p className="text-sm text-brand-500 mt-1">Remind me before my streak breaks</p>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
              <input
                type="checkbox"
                checked={preferences.streakWarnings.enabled}
                onChange={() => handleToggle('streakWarnings')}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-brand-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-brand-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-600"></div>
            </label>
          </div>
          {preferences.streakWarnings.enabled && (
            <div className="flex items-center gap-2 ml-13 pl-3 border-l-2 border-brand-200">
              <Clock className="w-4 h-4 text-brand-500" />
              <select
                value={preferences.streakWarnings.time}
                onChange={(e) => handleTimeChange('streakWarnings', e.target.value)}
                className="text-sm px-3 py-1.5 border border-brand-200 rounded-lg focus:ring-2 focus:ring-brand-400 focus:border-transparent bg-white"
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

        {/* Bill Reminders */}
        <div className="p-4 bg-brand-50 rounded-xl border border-brand-100">
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-start gap-3 flex-1">
              <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <Calendar className="w-5 h-5 text-purple-600" />
              </div>
              <div className="flex-1">
                <h4 className="font-semibold text-brand-800">Bill Payment Reminders</h4>
                <p className="text-sm text-brand-500 mt-1">Remind me about upcoming bills</p>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
              <input
                type="checkbox"
                checked={preferences.billReminders.enabled}
                onChange={() => handleToggle('billReminders')}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-brand-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-brand-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-600"></div>
            </label>
          </div>
          {preferences.billReminders.enabled && (
            <div className="ml-13 pl-3 border-l-2 border-brand-200 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-sm text-brand-600">Remind:</span>
                <input
                  type="number"
                  min="1"
                  max="7"
                  value={preferences.billReminders.daysBeforeDue}
                  onChange={(e) => handleDaysBeforeChange(Number(e.target.value))}
                  className="w-16 text-sm px-3 py-1.5 border border-brand-200 rounded-lg focus:ring-2 focus:ring-brand-400 focus:border-transparent"
                />
                <span className="text-sm text-brand-500">day(s) before due</span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-brand-500" />
                <select
                  value={preferences.billReminders.time}
                  onChange={(e) => handleTimeChange('billReminders', e.target.value)}
                  className="text-sm px-3 py-1.5 border border-brand-200 rounded-lg focus:ring-2 focus:ring-brand-400 focus:border-transparent bg-white"
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
      </div>

      {/* Save Button */}
      <button
        onClick={handleSave}
        disabled={isSaving}
        className="w-full bg-brand-600 text-white font-semibold py-3 px-4 rounded-xl hover:bg-brand-700 active:scale-95 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isSaving ? 'Saving...' : 'Save Preferences'}
      </button>
    </Card>
  );
};

export default NotificationSettings;
