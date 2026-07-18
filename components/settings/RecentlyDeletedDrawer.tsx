import React, { useState } from 'react';
import { Drawer } from '@/components/ui/Drawer';
import { SurfaceList, Row } from '@/components/ui/Section';
import EmptyState from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import {
  TRASH_DOMAIN_META,
  TRASH_RETENTION_DAYS,
  daysUntilPurge,
  trashItemTitle,
  trashItemSubtitle,
  type TrashedItem,
} from '@/utils/trash';
import { RotateCcw, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';

interface RecentlyDeletedDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * F-XCUT-03 — "Recently Deleted" recovery view. Lists soft-deleted records
 * (todos, shopping items, meals, planned meals, habits, transactions) from the unified trash,
 * newest-first, each with a one-tap Restore. Records auto-purge after
 * {@link TRASH_RETENTION_DAYS} days.
 *
 * The list is empty (with an explanatory note) until the separate, human-watched
 * `trash` firestore.rules PR ships — reads permission-deny before then.
 */
const RecentlyDeletedDrawer: React.FC<RecentlyDeletedDrawerProps> = ({ isOpen, onClose }) => {
  const { trashedItems, restoreTrashedItem, purgeTrashedItem } = useHouseholdCore();
  const [busyId, setBusyId] = useState<string | null>(null);

  // One "now" per render pass so all the day-counters in the list agree.
  const now = new Date();

  const handleRestore = async (item: TrashedItem) => {
    setBusyId(item.id);
    try {
      await restoreTrashedItem(item);
      toast.success(`Restored ${trashItemTitle(item)}`);
    } catch (error) {
      console.error('[RecentlyDeleted] Restore failed:', error);
      toast.error('Could not restore item');
    } finally {
      setBusyId(null);
    }
  };

  const handlePurge = async (item: TrashedItem) => {
    setBusyId(item.id);
    try {
      await purgeTrashedItem(item);
      toast.success('Permanently deleted');
    } catch (error) {
      console.error('[RecentlyDeleted] Purge failed:', error);
      toast.error('Could not delete item');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Drawer isOpen={isOpen} onClose={onClose} title="Recently Deleted">
      <div className="px-4 space-y-4">
        <p className="text-xs text-brand-500 dark:text-brand-400">
          Deleted to-dos, shopping items, meals, planned meals, habits, and transactions
          can be restored here for {TRASH_RETENTION_DAYS} days before they are removed for good.
        </p>

        {trashedItems.length === 0 ? (
          <EmptyState
            icon={<Trash2 />}
            title="Nothing to recover"
            description={`Items you delete show up here for ${TRASH_RETENTION_DAYS} days.`}
            size="compact"
            variant="dashed"
          />
        ) : (
          <SurfaceList>
            {trashedItems.map((item) => {
              const daysLeft = daysUntilPurge(item.deletedAt, now);
              const subtitle = trashItemSubtitle(item);
              const busy = busyId === item.id;
              return (
                <Row key={item.id}>
                  <div className="flex-1 min-w-0 text-left">
                    <p className="font-semibold text-brand-900 dark:text-brand-100 text-sm tracking-tight truncate">
                      {trashItemTitle(item)}
                    </p>
                    <p className="text-xs text-brand-500 dark:text-brand-400">
                      {TRASH_DOMAIN_META[item.domain].label}
                      {subtitle ? ` · ${subtitle}` : ''}
                      {' · '}
                      {daysLeft > 0 ? `${daysLeft}d left` : 'purges soon'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRestore(item)}
                      disabled={busy}
                      aria-label={`Restore ${trashItemTitle(item)}`}
                    >
                      <RotateCcw size={15} className="mr-1" />
                      Restore
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handlePurge(item)}
                      disabled={busy}
                      aria-label={`Permanently delete ${trashItemTitle(item)}`}
                    >
                      <Trash2 size={15} className="text-money-neg dark:text-money-negDark" />
                    </Button>
                  </div>
                </Row>
              );
            })}
          </SurfaceList>
        )}
      </div>
    </Drawer>
  );
};

export default RecentlyDeletedDrawer;
