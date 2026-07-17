/**
 * Pure logic for the post-onboarding setup checklist (F-PLAT-03).
 *
 * Every item is derived from existing context/browser state — no new
 * Firestore fields. Keeping the derivation pure (no Date.now()/localStorage
 * reads here) makes it trivially unit-testable; the impure bits (dismissal,
 * "first seen" timestamp, Notification.permission) live in the component.
 */

export type SetupChecklistItemId = 'bucket' | 'notifications' | 'invite' | 'bank';

export interface SetupChecklistItem {
  id: SetupChecklistItemId;
  title: string;
  description: string;
  /** Whether this item is already satisfied by existing state. */
  done: boolean;
  /** Route to deep-link to when the row is tapped. */
  route: string;
}

export interface SetupChecklistInputs {
  hasBucket: boolean;
  notificationsEnabled: boolean;
  hasSecondMember: boolean;
  /** Only relevant when `plaidEnabled` is true; otherwise the bank item is omitted. */
  plaidEnabled: boolean;
  plaidConnected: boolean;
}

/**
 * Builds the checklist item list from current state. The bank-linking item
 * only appears when Plaid is enabled for this deployment (`usePlaidEnabled()`);
 * omitting it (rather than showing it disabled) keeps the list honest about
 * what's actually actionable.
 */
export function computeSetupChecklistItems(inputs: SetupChecklistInputs): SetupChecklistItem[] {
  const items: SetupChecklistItem[] = [
    {
      id: 'bucket',
      title: 'Create a budget bucket',
      description: 'Group spending into categories like Groceries or Fun money.',
      done: inputs.hasBucket,
      route: '/budget',
    },
    {
      id: 'notifications',
      title: 'Turn on notifications',
      description: 'Get habit reminders, bill alerts, and streak warnings.',
      done: inputs.notificationsEnabled,
      route: '/settings?section=notifications',
    },
    {
      id: 'invite',
      title: 'Invite a household member',
      description: 'Share your invite code so everyone can pitch in.',
      done: inputs.hasSecondMember,
      route: '/settings?section=household',
    },
  ];

  if (inputs.plaidEnabled) {
    items.push({
      id: 'bank',
      title: 'Connect a bank account',
      description: 'Keep balances in sync automatically.',
      done: inputs.plaidConnected,
      route: '/settings?section=money',
    });
  }

  return items;
}

/** True once every generated item is done (drives the auto-hide). */
export function isSetupChecklistComplete(items: SetupChecklistItem[]): boolean {
  return items.length > 0 && items.every((item) => item.done);
}
