import React from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { Bell, Calendar, TrendingDown, Wallet, PiggyBank, ListChecks, Flame } from 'lucide-react';
import { useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { Drawer } from '@/components/ui/Drawer';
import { SurfaceList } from '@/components/ui/Section';
import EmptyState from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { NotificationLogEntry, NotificationLogType } from '@/types/schema';

interface NotificationInboxDrawerProps {
  open: boolean;
  onClose: () => void;
}

const TYPE_ICON: Record<NotificationLogType, React.ReactNode> = {
  habit_reminder: <ListChecks size={16} />,
  action_queue_reminder: <ListChecks size={16} />,
  streak_warning: <Flame size={16} />,
  bill_reminder: <Calendar size={16} />,
  budget_alert: <TrendingDown size={16} />,
  weekly_recap: <PiggyBank size={16} />,
  monthly_money_recap: <Wallet size={16} />,
  todo_reminder: <Bell size={16} />,
};

/**
 * F-NOTIF-02 — bell-icon feed of past pushes, opened from `TopToolbar`.
 * Read-only history: tapping an entry marks it read and, when the entry
 * carries a `data.url`, navigates there (mirrors how the push itself would
 * deep-link). Data comes from `useHouseholdCore().notificationLog`, which is
 * already filtered to the signed-in member's own entries — see the
 * flat-subcollection note on `NotificationLogEntry`.
 */
const NotificationInboxDrawer: React.FC<NotificationInboxDrawerProps> = ({ open, onClose }) => {
  const { notificationLog, unreadNotificationCount, markNotificationRead, markAllNotificationsRead, currentUser } =
    useHouseholdCore();
  const navigate = useNavigate();

  const handleEntryClick = (entry: NotificationLogEntry) => {
    if (currentUser && !entry.readBy.includes(currentUser.uid)) {
      void markNotificationRead(entry.id);
    }
    const url = entry.data?.url;
    if (url) {
      onClose();
      navigate(url);
    }
  };

  return (
    <Drawer isOpen={open} onClose={onClose} title="Notifications">
      <div className="flex flex-col gap-3">
        {unreadNotificationCount > 0 && (
          <div className="flex justify-end">
            <Button type="button" variant="ghost" size="sm" onClick={() => void markAllNotificationsRead()}>
              Mark all read
            </Button>
          </div>
        )}

        {notificationLog.length === 0 ? (
          <EmptyState
            variant="plain"
            icon={<Bell size={20} />}
            title="No notifications yet"
            description="Bill reminders, streak warnings, and recaps you've been sent will show up here."
          />
        ) : (
          <SurfaceList>
            {notificationLog.map((entry) => {
              const isUnread = !!currentUser && !entry.readBy.includes(currentUser.uid);
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => handleEntryClick(entry)}
                  className="flex w-full items-start justify-between gap-3 px-4 py-3.5 text-left hairline-divider transition-colors duration-(--duration-fast) ease-(--ease-standard) hover:bg-brand-50 dark:hover:bg-brand-700/40 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40 focus-visible:ring-inset first:border-t-0"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <span
                      className={`w-9 h-9 rounded-card flex items-center justify-center shrink-0 ${
                        isUnread
                          ? 'bg-accent-100 text-accent-700 dark:bg-accent-900/40 dark:text-accent-300'
                          : 'bg-brand-100 text-brand-500 dark:bg-brand-700/50 dark:text-brand-300'
                      }`}
                    >
                      {TYPE_ICON[entry.type]}
                    </span>
                    <div className="min-w-0">
                      <p
                        className={`text-sm truncate ${
                          isUnread
                            ? 'font-semibold text-brand-900 dark:text-brand-50'
                            : 'font-medium text-brand-700 dark:text-brand-200'
                        }`}
                      >
                        {entry.title}
                      </p>
                      <p className="text-xs text-brand-500 dark:text-brand-400 line-clamp-2">{entry.body}</p>
                      <p className="text-xxs text-brand-400 dark:text-brand-450 mt-0.5">
                        {formatDistanceToNow(parseISO(entry.createdAt), { addSuffix: true })}
                      </p>
                    </div>
                  </div>
                  {isUnread && (
                    <span
                      className="w-2 h-2 rounded-full bg-accent-600 shrink-0 mt-1.5"
                      aria-label="Unread"
                    />
                  )}
                </button>
              );
            })}
          </SurfaceList>
        )}
      </div>
    </Drawer>
  );
};

export default NotificationInboxDrawer;
