
import React, { useState, useMemo } from 'react';
import { useFinance } from '@/contexts/FirebaseHouseholdContext';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { Pencil, Plus, Target, Star, GripVertical, Trash2, MoreVertical, Landmark, CreditCard, Banknote, Archive, ArchiveRestore, ChevronDown, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { Account } from '@/types/schema';
import { roundMoney } from '@/utils/money';
import { computeNetWorth } from '@/utils/netWorth';
import { shouldOfferBalanceAdoption } from '@/utils/plaidBalance';
import { track } from '@/services/analytics';
import { cn } from '@/utils/cn';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Drawer';
import Input from '@/components/ui/Input';
import ProgressBar from '@/components/ui/ProgressBar';
import Select from '@/components/ui/Select';
import EmptyState from '@/components/ui/EmptyState';
import { Popover } from '@/components/ui/Popover';
import { SurfaceList, Row, DisclosureRow } from '@/components/ui/Section';
import SectionHeading from '@/components/ui/SectionHeading';
import Eyebrow from '@/components/ui/Eyebrow';
import SavingsGoals from '@/components/budget/SavingsGoals';

const BudgetAccounts: React.FC = () => {
  const { accounts, updateAccountBalance, addAccount, setAccountGoal, setAccountCardDetails, deleteAccount, archiveAccount, unarchiveAccount, reorderAccounts } = useFinance();
  const [showArchived, setShowArchived] = useState(false);
  const fmt = useFormatCurrency();

  // Edit Balance Drawer (id of the account being edited, or null). The balance
  // row is a `DisclosureRow`, whose chevron promises a drill-in — so it opens a
  // Drawer bottom sheet like every other form on this page, never an in-place
  // accordion (see the DisclosureRow JSDoc in components/ui/Section.tsx).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');

  // Add Account Modal
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<Account['type']>('checking');
  const [newBalance, setNewBalance] = useState('');
  const [newCardLast4, setNewCardLast4] = useState('');
  const [newAccountLast4, setNewAccountLast4] = useState('');

  // Set Goal Modal
  const [isGoalModalOpen, setIsGoalModalOpen] = useState<string | null>(null);
  const [goalAmount, setGoalAmount] = useState('');

  // Account Number & Cards Modal (id of the account being tagged, or null).
  // `cardChips` holds the account's tagged debit/credit cards as chips; a
  // legacy single `cardLast4` is migrated in as the first chip when opened.
  const [isCardModalOpen, setIsCardModalOpen] = useState<string | null>(null);
  const [accountLast4Digits, setAccountLast4Digits] = useState('');
  const [cardChips, setCardChips] = useState<string[]>([]);
  const [cardChipDraft, setCardChipDraft] = useState('');

  // Delete confirmation
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Mobile Actions
  const [actionAccount, setActionAccount] = useState<Account | null>(null);

  // Id of the account whose last-4 popover is open (only one at a time).
  const [last4PopoverId, setLast4PopoverId] = useState<string | null>(null);

  // Drag state
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  // Group and sort accounts. Archived accounts (F-MONEY-08) are excluded from
  // the active lists and net worth — they're a display-only history section.
  const { assetAccounts, liabilityAccounts, archivedAccounts, assets, debts, netWorth } = useMemo(() => {
    const activeAccounts = accounts.filter(a => !a.archived);
    const assetAccts = activeAccounts
      .filter(a => a.type !== 'credit')
      .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
    const liabilityAccts = activeAccounts
      .filter(a => a.type === 'credit')
      .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
    const archivedAccts = accounts
      .filter(a => a.archived)
      .sort((a, b) => a.name.localeCompare(b.name));

    const { totalAssets, totalLiabilities, netWorth: net } = computeNetWorth(activeAccounts);

    return {
      assetAccounts: assetAccts,
      liabilityAccounts: liabilityAccts,
      archivedAccounts: archivedAccts,
      assets: totalAssets,
      debts: totalLiabilities,
      netWorth: net
    };
  }, [accounts]);

  // The account currently open in the "Account Number & Cards" drawer, used to
  // gate card-chip editing for savings accounts — Add Account already hides
  // card entry for savings (no debit/credit card routes to a savings account),
  // so this entry point must match rather than silently offering it anyway.
  const cardModalAccount = isCardModalOpen
    ? (accounts.find(a => a.id === isCardModalOpen) ?? null)
    : null;
  const isCardModalSavings = cardModalAccount?.type === 'savings';

  // The account currently open in the Edit Balance drawer, so the sheet can
  // name which balance is being changed (the row that opened it is behind the
  // backdrop by then).
  const editingAccount = editingId
    ? (accounts.find(a => a.id === editingId) ?? null)
    : null;

  const handleAddAccount = () => {
    if (!newName || !newBalance) return;
    const isLiability = newType === 'credit';
    const relevantAccounts = isLiability ? liabilityAccounts : assetAccounts;
    const maxOrder = relevantAccounts.length > 0
      ? Math.max(...relevantAccounts.map(a => a.order ?? 0))
      : -1;

    // Keep only the last 4 digits so "...8899" and "8899" both store cleanly.
    // A partial (1-3 digit) entry would store a value that can never match an
    // incoming card, so reject it rather than saving something silently useless.
    const rawDigits = newCardLast4.replace(/\D/g, '');
    if (rawDigits && rawDigits.length < 4) {
      toast.error('Card digits must be the last 4 numbers');
      return;
    }
    const digits = rawDigits.slice(-4);

    // Same 4-digit validation for the account number field.
    const rawAccountDigits = newAccountLast4.replace(/\D/g, '');
    if (rawAccountDigits && rawAccountDigits.length < 4) {
      toast.error('Account number digits must be the last 4 numbers');
      return;
    }
    const accountDigits = rawAccountDigits.slice(-4);

    const newAccount: Account = {
      id: crypto.randomUUID(),
      name: newName,
      type: newType,
      balance: parseFloat(newBalance),
      lastUpdated: new Date().toISOString(),
      order: maxOrder + 1,
      ...(digits ? { cardLast4s: [digits] } : {}),
      ...(accountDigits ? { accountLast4: accountDigits } : {}),
    };
    addAccount(newAccount);
    setIsAddModalOpen(false);
    setNewName('');
    setNewBalance('');
    setNewCardLast4('');
    setNewAccountLast4('');
  };

  const handleSetGoal = async () => {
    if (isGoalModalOpen && goalAmount) {
      // Await the write and only close on success, so a failed Firestore write
      // surfaces an error (no unhandled rejection) and the user can retry
      // without losing the drawer.
      try {
        await setAccountGoal(isGoalModalOpen, parseFloat(goalAmount));
        setIsGoalModalOpen(null);
        setGoalAmount('');
      } catch (error) {
        console.error('Failed to set savings goal', error);
        toast.error('Failed to set goal. Please try again.');
      }
    }
  };

  // Normalizes a chip-editor entry to its last 4 digits, or null if the entry
  // is too short to ever match an incoming card/account number.
  const cleanChipDigits = (raw: string): string | null => {
    const digits = raw.replace(/\D/g, '').slice(-4);
    return digits.length === 4 ? digits : null;
  };

  const handleAddCardChip = () => {
    const digits = cleanChipDigits(cardChipDraft);
    if (!digits) {
      toast.error('Card digits must be the last 4 numbers');
      return;
    }
    if (cardChips.includes(digits)) {
      toast.error('That card is already added');
      return;
    }
    setCardChips(chips => [...chips, digits]);
    setCardChipDraft('');
  };

  const handleRemoveCardChip = (digits: string) => {
    setCardChips(chips => chips.filter(c => c !== digits));
  };

  const handleSetCard = async () => {
    if (!isCardModalOpen) return;
    const rawAccountDigits = accountLast4Digits.replace(/\D/g, '');
    if (rawAccountDigits && rawAccountDigits.length < 4) {
      toast.error('Account number digits must be the last 4 numbers');
      return;
    }
    // An uncommitted card chip draft (typed but never "Add"ed) would
    // otherwise be silently discarded on Save. Fold it in as if Added when
    // it's a valid 4-digit entry; block the save with a clear message when
    // it's non-empty but not a usable last-4.
    let finalCardChips = isCardModalSavings ? [] : cardChips;
    if (!isCardModalSavings && cardChipDraft.trim()) {
      const draftDigits = cleanChipDigits(cardChipDraft);
      if (!draftDigits) {
        toast.error('Card digits must be the last 4 numbers');
        return;
      }
      finalCardChips = cardChips.includes(draftDigits)
        ? cardChips
        : [...cardChips, draftDigits];
    }
    // Await the write and only close on success, so a failed Firestore write
    // surfaces an error (no unhandled rejection) and the drawer stays open to
    // retry.
    try {
      await setAccountCardDetails(isCardModalOpen, {
        accountLast4: rawAccountDigits.slice(-4),
        cardLast4s: finalCardChips,
      });
      setIsCardModalOpen(null);
      setAccountLast4Digits('');
      setCardChips([]);
      setCardChipDraft('');
    } catch (error) {
      console.error('Failed to save account details', error);
      toast.error('Failed to save account details. Please try again.');
    }
  };

  const handleDeleteAccount = async () => {
    if (!deletingId || isDeleting) return;
    setIsDeleting(true);
    try {
      await deleteAccount(deletingId);
      setDeletingId(null);
    } catch (error) {
      console.error('Failed to delete account', error);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleArchiveAccount = async (id: string) => {
    try {
      await archiveAccount(id);
    } catch (error) {
      console.error('Failed to archive account', error);
      toast.error('Failed to archive account. Please try again.');
    }
  };

  const handleUnarchiveAccount = async (id: string) => {
    try {
      await unarchiveAccount(id);
    } catch (error) {
      console.error('Failed to unarchive account', error);
      toast.error('Failed to unarchive account. Please try again.');
    }
  };

  const startEditing = (id: string, currentBalance: number) => {
    setEditingId(id);
    // Seed with a rounded, 2-decimal string — `currentBalance` can carry
    // accumulated float drift (e.g. 125.777777777779 from summed
    // sub-balances), which would otherwise land in the input verbatim and
    // force the user to manually trim it before every edit.
    setEditValue(roundMoney(currentBalance).toFixed(2));
  };

  const saveEditing = (id: string) => {
    const num = parseFloat(editValue);
    if (!isNaN(num)) {
      // Round on save too, so an unrounded float (e.g. from a pasted value)
      // can't reintroduce the same float-drift display bug next time this
      // balance is edited.
      updateAccountBalance(id, roundMoney(num));
    }
    setEditingId(null);
  };

  // Adopt the advisory Plaid balance for an account: writes through the
  // NORMAL balance-update path (same as manual editing) so history/alerts
  // fire correctly — never a direct Firestore write. The manual `balance`
  // field remains authoritative; this just syncs it to match the bank.
  const handleAdoptPlaidBalance = (account: Account) => {
    if (typeof account.plaidBalanceCurrent !== 'number') return;
    updateAccountBalance(account.id, roundMoney(account.plaidBalanceCurrent));
    track('plaid_balance_adopted');
  };

  // Drag handlers
  const handleDragStart = (e: React.DragEvent, accountId: string) => {
    setDraggedId(accountId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', accountId);
  };

  const handleDragOver = (e: React.DragEvent, accountId: string) => {
    e.preventDefault();
    if (draggedId !== accountId) {
      setDragOverId(accountId);
    }
  };

  const handleDragLeave = () => {
    setDragOverId(null);
  };

  const handleDrop = (e: React.DragEvent, targetId: string, isLiabilityGroup: boolean) => {
    e.preventDefault();
    if (!draggedId || draggedId === targetId) {
      setDraggedId(null);
      setDragOverId(null);
      return;
    }

    const relevantAccounts = isLiabilityGroup ? liabilityAccounts : assetAccounts;
    const draggedAccount = relevantAccounts.find(a => a.id === draggedId);

    // Only allow reordering within same group
    if (!draggedAccount) {
      setDraggedId(null);
      setDragOverId(null);
      return;
    }

    // Reorder
    const newOrder = relevantAccounts.filter(a => a.id !== draggedId);
    const targetIndex = newOrder.findIndex(a => a.id === targetId);
    newOrder.splice(targetIndex, 0, draggedAccount);

    // Save new order
    reorderAccounts(newOrder.map(a => a.id));

    setDraggedId(null);
    setDragOverId(null);
  };

  const handleDragEnd = () => {
    setDraggedId(null);
    setDragOverId(null);
  };

  const renderAccountRow = (account: Account, isLiabilityGroup: boolean) => {
    const isLiability = account.type === 'credit';
    const isSavings = account.type === 'savings';
    // Legacy `cardLast4` is treated as an extra (deduped) entry of `cardLast4s`
    // for display, mirroring the read-side handling in accountMatch.ts.
    const allCardLast4s = Array.from(
      new Set([...(account.cardLast4 ? [account.cardLast4] : []), ...(account.cardLast4s ?? [])])
    );
    // Every last-4 the account carries, cards first then the account number.
    const last4Entries = [
      ...allCardLast4s.map(d => ({ key: `card-${d}`, digits: d, label: 'Card', isAccount: false })),
      ...(account.accountLast4
        ? [{ key: 'account', digits: account.accountLast4, label: 'Account no.', isAccount: true }]
        : []),
    ];
    const soleLast4 = last4Entries.length === 1 ? last4Entries[0] : undefined;
    const progress = account.monthlyGoal ? Math.min(100, (account.balance / account.monthlyGoal) * 100) : 0;
    const hitGoal = account.monthlyGoal && account.balance >= account.monthlyGoal;
    const isDragging = draggedId === account.id;
    const isDragOver = dragOverId === account.id;
    const bankBalance = account.plaidBalanceCurrent ?? 0;

    return (
      /* One account = ONE grouped block, not N sibling rows. The block draws
         the only hairline (separating it from the next account) and cancels
         every hairline the `Row`/`DisclosureRow` primitives draw inside it —
         the descendant-class selector is what wins over `.hairline-divider`'s
         own specificity (same trick as ToDosPage's flush list card). */
      <div
        key={account.id}
        draggable
        onDragStart={(e) => handleDragStart(e, account.id)}
        onDragOver={(e) => handleDragOver(e, account.id)}
        onDragLeave={handleDragLeave}
        onDrop={(e) => handleDrop(e, account.id, isLiabilityGroup)}
        onDragEnd={handleDragEnd}
        className={cn(
          'hairline-divider [&_.hairline-divider]:border-t-0',
          'transition-[opacity,transform,background-color] duration-(--duration-base) ease-(--ease-standard)',
          isDragging && 'opacity-50 scale-95',
          isDragOver && 'bg-accent-50 dark:bg-accent-900/20'
        )}
      >
        <Row className="pb-1.5 items-start">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {/* Drag Handle */}
            <div className="cursor-grab active:cursor-grabbing text-brand-300 dark:text-brand-500 hover:text-brand-500 dark:hover:text-brand-400 touch-none shrink-0">
              <GripVertical size={18} />
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-brand-900 dark:text-brand-100 truncate">{account.name}</p>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-0.5">
                <Badge variant={isLiability ? 'danger' : 'success'} size="sm" className="uppercase shrink-0">
                  {account.type}
                </Badge>
                {/* All last-4s collapse into ONE inline control so the row
                    never wraps to a second line. A lone value reads inline;
                    two or more become a card glyph + count that opens a
                    popover listing each identifier. */}
                {soleLast4 && (
                  <span className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-mono text-brand-500 dark:text-brand-400 shrink-0">
                    {soleLast4.isAccount ? <Landmark size={11} aria-hidden /> : <CreditCard size={11} aria-hidden />}
                    ···{soleLast4.digits}
                  </span>
                )}
                {last4Entries.length > 1 && (
                  <div className="relative shrink-0">
                    <button
                      type="button"
                      onClick={() => setLast4PopoverId(id => (id === account.id ? null : account.id))}
                      aria-haspopup="dialog"
                      aria-expanded={last4PopoverId === account.id}
                      aria-label={`Show ${last4Entries.length} card and account numbers for ${account.name}`}
                      className="inline-flex items-center gap-1 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[11px] font-mono text-brand-500 dark:text-brand-400 hover:bg-brand-100 dark:hover:bg-brand-700/50 hover:text-brand-700 dark:hover:text-brand-200 transition-colors duration-(--duration-fast) ease-(--ease-standard) focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40"
                    >
                      <CreditCard size={11} aria-hidden />
                      {last4Entries.length}
                    </button>
                    <Popover
                      isOpen={last4PopoverId === account.id}
                      onClose={() => setLast4PopoverId(null)}
                      role="dialog"
                      ariaLabel={`Card and account numbers for ${account.name}`}
                      position="top-full left-0 mt-1"
                      className="w-52 py-1"
                    >
                      {last4Entries.map(e => (
                        <span key={e.key} className="flex items-center gap-2 px-3 py-1.5 text-xs font-mono text-brand-700 dark:text-brand-200">
                          {e.isAccount
                            ? <Landmark size={12} aria-hidden className="shrink-0 text-brand-400 dark:text-brand-450" />
                            : <CreditCard size={12} aria-hidden className="shrink-0 text-brand-400 dark:text-brand-450" />}
                          <span>···{e.digits}</span>
                          <span className="ml-auto font-sans text-xxs text-brand-400 dark:text-brand-450">{e.label}</span>
                        </span>
                      ))}
                    </Popover>
                  </div>
                )}
              </div>
            </div>
            {isSavings && (
              <Button
                variant="subtle"
                size="icon-sm"
                onClick={() => setIsGoalModalOpen(account.id)}
                className="hover:text-habit-gold hover:bg-warm-50 dark:hover:bg-warm-500/15 hidden sm:flex shrink-0"
                aria-label={`Set savings goal for ${account.name}`}
              >
                <Target size={14} />
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Archive button (Desktop) */}
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => handleArchiveAccount(account.id)}
              className="text-brand-400 dark:text-brand-450 hidden sm:flex"
              aria-label={`Archive ${account.name} account`}
            >
              <Archive size={14} />
            </Button>

            {/* Delete button (Desktop) */}
            <Button
              variant="ghost-destructive"
              size="icon-sm"
              onClick={() => setDeletingId(account.id)}
              className="text-brand-400 dark:text-brand-450 hidden sm:flex"
              aria-label={`Delete ${account.name} account`}
            >
              <Trash2 size={14} />
            </Button>

            {/* Mobile Actions (replacing small buttons) */}
            <div className="sm:hidden">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setActionAccount(account)}
                className="text-brand-400 dark:text-brand-450"
                aria-label={`Options for ${account.name}`}
              >
                <MoreVertical size={20} />
              </Button>
            </div>
          </div>
        </Row>

        {/* Balance — the affordance IS the row. Previously this was a bare
            figure with a 10px "Tap to edit" hint at 1.69:1 contrast; the row
            now carries its own hover/press/focus states and a chevron, the
            same language as every Settings drill-in row. The chevron means
            "drills into a Drawer", and it does — the amount field lives in the
            Edit Balance sheet at the bottom of this file. */}
        <DisclosureRow
          className="min-h-11"
          /* The visible label is just "Balance" (the account name is already
             the line above it), but the accessible name has to stand alone —
             a screen-reader user landing on the row otherwise hears "Balance
             $5,000.00" with no idea whose. Each text node is trimmed before
             the accessible name is joined, so the account name goes in as one
             complete phrase rather than as a leading-space fragment. */
          title={
            <>
              <span className="sr-only">{`Balance for ${account.name}`}</span>
              <span aria-hidden="true">Balance</span>
            </>
          }
          value={
            <span
              className={cn(
                'font-mono tabular-nums font-bold text-lg',
                isLiability
                  ? 'text-money-neg dark:text-money-negDark'
                  : 'text-money-pos dark:text-money-posDark'
              )}
            >
              {fmt(account.balance)}
            </span>
          }
          onClick={() => startEditing(account.id, account.balance)}
        />

        {/* Savings Goal Bar */}
        {isSavings && account.monthlyGoal && (
          <div className="px-4 pb-3">
            <div className="flex justify-between text-xxs text-brand-400 dark:text-brand-450 mb-1">
              <span className="flex items-center gap-1">{hitGoal && <Star size={10} className="fill-habit-gold text-habit-gold"/>} {Math.round(progress)}% to goal</span>
              <span>Target: {fmt(account.monthlyGoal)}</span>
            </div>
            <ProgressBar
              value={progress}
              className="h-1.5 bg-brand-100 dark:bg-brand-700"
              barClassName="bg-habit-gold"
              ariaLabel={`${Math.round(progress)}% to goal`}
            />
          </div>
        )}

        {/* Advisory Plaid balance — only when a linked bank balance has
            diverged from the manual balance by more than the threshold. The
            entered balance disagreeing with the bank is a real attention
            state, so it gets a full-width row in the amber (caution) voice
            rather than a 23px footnote chip. */}
        {shouldOfferBalanceAdoption(account) && (
          <Row dense className="min-h-11 justify-between gap-3 pb-3">
            <span className="flex min-w-0 items-center gap-2 text-sm text-warm-600 dark:text-warm-300">
              <Banknote size={16} aria-hidden className="shrink-0" />
              <span className="truncate">Bank says {fmt(bankBalance)}</span>
            </span>
            <Button
              variant="warning"
              size="sm"
              className="shrink-0"
              onClick={() => handleAdoptPlaidBalance(account)}
              aria-label={`Update ${account.name} to the bank balance ${fmt(bankBalance)}`}
            >
              Update
            </Button>
          </Row>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Net Worth — compact stat row (was an oversized p-8 hero; Assets/
          Liabilities totals are repeated in the section headers below, so this
          keeps only the headline figure — UX audit Batch 3). */}
      <div className="bg-accent-600 dark:bg-accent-700 rounded-lg px-5 py-4 text-white shadow-raised flex items-center justify-between">
        {/* A stat caption, so it's the micro-caps `Eyebrow` voice — not the
            serif-wearing-eyebrow-clothes third voice this used to be. */}
        <Eyebrow as="p" className="text-white/70 dark:text-white/70">Total net worth</Eyebrow>
        <p className="text-2xl font-mono font-bold tracking-tight tabular-nums">
          {fmt(netWorth)}
        </p>
      </div>

      {/* Assets Section */}
      {assetAccounts.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 px-1">
            {/* A content grouping the reader scans by, so it's the editorial
                serif `SectionHeading` voice in sentence case (DESIGN.md §3). */}
            <SectionHeading className="shrink-0">Assets</SectionHeading>
            <div className="flex-1 h-px bg-brand-200 dark:bg-brand-700"></div>
            <span className="text-sm font-mono tabular-nums text-money-pos dark:text-money-posDark">{fmt(assets)}</span>
          </div>
          {/* overflow-visible so the last row's last-4 popover isn't clipped
              by the grouped surface. */}
          <SurfaceList className="overflow-visible">
            {assetAccounts.map(account => renderAccountRow(account, false))}
          </SurfaceList>
        </div>
      )}

      {/* Liabilities Section */}
      {liabilityAccounts.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 px-1">
            <SectionHeading className="shrink-0">Liabilities</SectionHeading>
            <div className="flex-1 h-px bg-brand-200 dark:bg-brand-700"></div>
            <span className="text-sm font-mono tabular-nums text-money-neg dark:text-money-negDark">{fmt(debts)}</span>
          </div>
          <SurfaceList className="overflow-visible">
            {liabilityAccounts.map(account => renderAccountRow(account, true))}
          </SurfaceList>
        </div>
      )}

      {/* Add Account Button — rendered when at least one account exists, positioned
          directly after the Liabilities section. When zero accounts exist, the
          EmptyState below provides the primary action. */}
      {(assetAccounts.length > 0 || liabilityAccounts.length > 0) && (
        <Button
          variant="dashed"
          size="sm"
          onClick={() => setIsAddModalOpen(true)}
          className="w-full py-2.5 rounded-card"
          leftIcon={<Plus size={16} />}
        >
          Add Account
        </Button>
      )}

      {/* Savings Goals (Plan 24) — near the existing per-account monthlyGoal
          affordance above, per the design spike. */}
      <SavingsGoals />

      {/* Archived Accounts (F-MONEY-08) — collapsed history section. Hidden
          from active lists/net worth/Safe-to-Spend, but transactions tagged
          to these accounts still resolve correctly. */}
      {archivedAccounts.length > 0 && (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setShowArchived(v => !v)}
            aria-expanded={showArchived}
            aria-controls="archived-accounts-list"
            className="flex w-full items-center gap-1.5 px-1 text-left text-xs font-semibold text-brand-500 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-200 transition-colors duration-(--duration-fast) ease-(--ease-standard) focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-brand-800 rounded-btn"
          >
            <Archive size={12} aria-hidden />
            Archived accounts ({archivedAccounts.length})
            <ChevronDown
              size={14}
              className={cn(
                'transition-transform duration-(--duration-base) ease-(--ease-standard)',
                showArchived && 'rotate-180'
              )}
            />
          </button>
          {showArchived && (
            <SurfaceList id="archived-accounts-list">
              {archivedAccounts.map(account => (
                <Row key={account.id} className="items-center justify-between gap-3 opacity-70">
                  <div className="min-w-0">
                    <p className="font-semibold text-brand-700 dark:text-brand-300 truncate">{account.name}</p>
                    <Badge variant={account.type === 'credit' ? 'danger' : 'success'} size="sm" className="uppercase">
                      {account.type}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <p className="font-mono tabular-nums font-bold text-sm text-brand-500 dark:text-brand-400">
                      {fmt(account.balance)}
                    </p>
                    <Button
                      variant="subtle"
                      size="icon-sm"
                      onClick={() => handleUnarchiveAccount(account.id)}
                      aria-label={`Unarchive ${account.name} account`}
                    >
                      <ArchiveRestore size={14} />
                    </Button>
                  </div>
                </Row>
              ))}
            </SurfaceList>
          )}
        </div>
      )}

      {/* Empty State */}
      {assetAccounts.length === 0 && liabilityAccounts.length === 0 && (
        <EmptyState
          variant="surface"
          icon={<Landmark size={28} />}
          title="No accounts yet"
          description="Add your checking, savings, and credit accounts to track your net worth."
          action={
            <Button
              variant="primary"
              onClick={() => setIsAddModalOpen(true)}
              leftIcon={<Plus size={18} />}
            >
              Add Account
            </Button>
          }
        />
      )}

      {/* Add Account Drawer */}
      <Drawer
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        title="Add Account"
        footer={
          <div className="flex gap-2 border-t border-brand-200 dark:border-brand-700 p-4">
            <Button
              onClick={handleAddAccount}
              className="w-full py-3"
            >
              Save Account
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Input
            placeholder="Account Name"
            value={newName}
            onChange={e => setNewName(e.target.value)}
          />
          <Select
            value={newType}
            onChange={(e) => setNewType(e.target.value as Account['type'])}
          >
            <option value="checking">Checking</option>
            <option value="savings">Savings</option>
            <option value="credit">Credit Card</option>
          </Select>
          <Input
            type="number"
            inputMode="decimal"
            placeholder="Current Balance"
            value={newBalance}
            onChange={e => setNewBalance(e.target.value)}
            className="font-mono"
          />
          <div>
            <Input
              inputMode="numeric"
              placeholder="Account number last 4 (optional)"
              value={newAccountLast4}
              onChange={e => setNewAccountLast4(e.target.value)}
              maxLength={19}
              className="font-mono"
            />
            <p className="text-xs text-brand-500 dark:text-brand-400 mt-1">
              From a bank email like &ldquo;for account &hellip;5581&rdquo; — lets nightly bank-email sync route rows to this account.
            </p>
          </div>
          {newType !== 'savings' && (
            <div>
              <Input
                inputMode="numeric"
                placeholder="Card last 4 digits (optional)"
                value={newCardLast4}
                onChange={e => setNewCardLast4(e.target.value)}
                maxLength={19}
                className="font-mono"
              />
              <p className="text-xs text-brand-500 dark:text-brand-400 mt-1">
                Lets bank-alert Shortcuts (e.g. Wells Fargo emails) route purchases to this account.
              </p>
            </div>
          )}
        </div>
      </Drawer>

      {/* Edit Balance Drawer — the destination the balance row's chevron
          promises. Same shell as the Set Savings Goal sheet below it (sticky
          footer CTA, single field) so the two drill-ins feel identical. */}
      <Drawer
        isOpen={!!editingId}
        onClose={() => setEditingId(null)}
        title="Update Balance"
        footer={
          <div className="flex gap-2 border-t border-brand-200 dark:border-brand-700 p-4">
            <Button
              onClick={() => { if (editingId) saveEditing(editingId); }}
              className="w-full py-3"
            >
              Save Balance
            </Button>
          </div>
        }
      >
        <p className="text-sm text-brand-500 dark:text-brand-400 mb-4">
          {editingAccount
            ? `What is the current balance of ${editingAccount.name}?`
            : 'What is the current balance of this account?'}
        </p>
        <Input
          label="Balance"
          type="number"
          inputMode="decimal"
          value={editValue}
          onChange={e => setEditValue(e.target.value)}
          className="font-mono"
          // The Drawer's focus trap prefers [data-autofocus]; a plain autoFocus
          // is clobbered by the trap and focus lands on the close button.
          data-autofocus
        />
      </Drawer>

      {/* Goal Drawer */}
      <Drawer
        isOpen={!!isGoalModalOpen}
        onClose={() => setIsGoalModalOpen(null)}
        title="Set Savings Goal"
        footer={
          <div className="flex gap-2 border-t border-brand-200 dark:border-brand-700 p-4">
            <Button
              onClick={handleSetGoal}
              className="w-full py-3"
            >
              Set Goal
            </Button>
          </div>
        }
      >
        <p className="text-sm text-brand-500 dark:text-brand-400 mb-4">
          What is your target balance for this account?
        </p>
        <Input
          type="number"
          inputMode="decimal"
          placeholder="Goal Amount"
          value={goalAmount}
          onChange={e => setGoalAmount(e.target.value)}
          className="font-mono"
          autoFocus
        />
      </Drawer>

      {/* Account Number & Cards Drawer */}
      <Drawer
        isOpen={!!isCardModalOpen}
        onClose={() => setIsCardModalOpen(null)}
        title="Account Number & Cards"
        footer={
          <div className="flex gap-2 border-t border-brand-200 dark:border-brand-700 p-4">
            <Button
              onClick={handleSetCard}
              className="w-full py-3"
            >
              Save
            </Button>
          </div>
        }
      >
        <div className="space-y-1 mb-5">
          <label className="text-xs font-semibold text-brand-600 dark:text-brand-300 uppercase tracking-wide">
            Account number last 4
          </label>
          <Input
            inputMode="numeric"
            placeholder="e.g. 5581"
            value={accountLast4Digits}
            onChange={e => setAccountLast4Digits(e.target.value)}
            maxLength={19}
            className="font-mono"
          />
          <p className="text-xs text-brand-500 dark:text-brand-400">
            From a bank email like &ldquo;for account &hellip;5581&rdquo;. Leave blank to clear.
          </p>
        </div>

        {!isCardModalSavings && (
          <div className="space-y-2">
            <label className="text-xs font-semibold text-brand-600 dark:text-brand-300 uppercase tracking-wide">
              Cards on this account
            </label>
            {cardChips.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {cardChips.map(digits => (
                  <span
                    key={digits}
                    className="inline-flex items-center gap-1.5 rounded-full bg-brand-100 dark:bg-brand-700/50 pl-3 pr-1.5 py-1 text-xs font-mono text-brand-700 dark:text-brand-200"
                  >
                    <CreditCard size={11} aria-hidden />
                    ···{digits}
                    <button
                      type="button"
                      onClick={() => handleRemoveCardChip(digits)}
                      aria-label={`Remove card ending ${digits}`}
                      className="rounded-full p-0.5 hover:bg-brand-200 dark:hover:bg-brand-600 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40"
                    >
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <Input
                inputMode="numeric"
                placeholder="Add card last 4 (e.g. 8899)"
                value={cardChipDraft}
                onChange={e => setCardChipDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddCardChip();
                  }
                }}
                maxLength={19}
                className="font-mono flex-1"
              />
              <Button variant="secondary" onClick={handleAddCardChip}>
                Add
              </Button>
            </div>
            <p className="text-xs text-brand-500 dark:text-brand-400">
              Bank-alert Shortcuts (e.g. Wells Fargo purchase emails) use these to route transactions to the right account.
            </p>
          </div>
        )}
      </Drawer>

      {/* Mobile Actions Drawer */}
      <Drawer
        isOpen={!!actionAccount}
        onClose={() => setActionAccount(null)}
        title={actionAccount?.name || 'Account Options'}
      >
        <div className="space-y-3 pb-6">
          {actionAccount && (
            <>
              {/* Edit Balance Action */}
              <Button
                variant="ghost"
                className="w-full justify-start text-lg py-4"
                leftIcon={<Pencil className="text-brand-500" />}
                onClick={() => {
                  startEditing(actionAccount.id, actionAccount.balance);
                  setActionAccount(null);
                }}
              >
                Edit Balance
              </Button>

              {/* Set Savings Goal (if applicable) */}
              {actionAccount.type === 'savings' && (
                <Button
                  variant="ghost"
                  className="w-full justify-start text-lg py-4"
                  leftIcon={<Target className="text-brand-500" />}
                  onClick={() => {
                    setIsGoalModalOpen(actionAccount.id);
                    setActionAccount(null);
                  }}
                >
                  Set Savings Goal
                </Button>
              )}

              {/* Account number & cards (migrates the legacy single cardLast4
                  into the chips list the first time this drawer is opened) */}
              <Button
                variant="ghost"
                className="w-full justify-start text-lg py-4"
                leftIcon={<CreditCard className="text-brand-500" />}
                onClick={() => {
                  setAccountLast4Digits(actionAccount.accountLast4 ?? '');
                  setCardChips(Array.from(
                    new Set([
                      ...(actionAccount.cardLast4 ? [actionAccount.cardLast4] : []),
                      ...(actionAccount.cardLast4s ?? []),
                    ])
                  ));
                  setCardChipDraft('');
                  setIsCardModalOpen(actionAccount.id);
                  setActionAccount(null);
                }}
              >
                Account Number & Cards
              </Button>

              <div className="h-px bg-brand-200 dark:bg-brand-700 my-2" />

              {/* Archive Action */}
              <Button
                variant="ghost"
                className="w-full justify-start text-lg py-4"
                leftIcon={<Archive className="text-brand-500" />}
                onClick={() => {
                  handleArchiveAccount(actionAccount.id);
                  setActionAccount(null);
                }}
              >
                Archive Account
              </Button>

              {/* Delete Action */}
              <Button
                variant="ghost-destructive"
                className="w-full justify-start text-lg py-4"
                leftIcon={<Trash2 />}
                onClick={() => {
                  setDeletingId(actionAccount.id);
                  setActionAccount(null);
                }}
              >
                Delete Account
              </Button>

              {/* Cancel */}
              <Button
                variant="ghost"
                className="w-full justify-center py-4"
                onClick={() => setActionAccount(null)}
              >
                Cancel
              </Button>
            </>
          )}
        </div>
      </Drawer>

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={!!deletingId}
        onClose={() => { if (!isDeleting) setDeletingId(null); }}
        onConfirm={handleDeleteAccount}
        title="Delete Account?"
        message="Are you sure you want to delete this account? This action cannot be undone."
        confirmLabel="Delete"
        confirmVariant="destructive"
        isConfirming={isDeleting}
      />
    </div>
  );
};

export default BudgetAccounts;