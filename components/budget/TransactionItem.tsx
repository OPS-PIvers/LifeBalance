import { memo, type KeyboardEvent } from 'react';
import { History, FileText, ArrowUpRight, ArrowDownLeft, Edit, Trash2, CheckSquare, Copy, Scissors, MoreVertical, MessageSquare } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { Transaction, INCOME_CATEGORY } from '@/types/schema';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Row } from '@/components/ui/Section';
import { cn } from '@/utils/cn';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { useMerchantRules } from '@/hooks/useMerchantRules';

// --- Helper Functions ---

const getSourceIcon = (source: string, isRecurring: boolean) => {
  if (isRecurring) return <History size={12} className="text-warm-500" />;
  if (source === 'camera-scan' || source === 'file-upload' || source === 'image-capture') return <FileText size={12} className="text-habit-blue" />;
  return null;
};

/**
 * Strip punctuation and clamp a merchant descriptor so it reads cleanly when a
 * screen reader speaks it inside an `aria-label`.
 */
const sanitizeMerchantName = (name: string) => {
  // Replace all non-alphanumeric chars (except spaces) with nothing
  // Then replace multiple spaces with single space
  const sanitizedName = name.replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  return sanitizedName.length > 30 ? `${sanitizedName.slice(0, 30)}...` : sanitizedName;
};

const getSanitizedLabel = (name: string, action: string) =>
  `${action} transaction from ${sanitizeMerchantName(name)}`;

// --- Memoized Transaction Item Component ---

export interface TransactionItemProps {
  transaction: Transaction;
  onEdit: (tx: Transaction) => void;
  onDelete: (tx: Transaction) => void;
  onDuplicate: (tx: Transaction) => void;
  onSplit: (tx: Transaction) => void;
  onMore?: (tx: Transaction) => void;
  isSelectionMode: boolean;
  isSelected: boolean;
  onToggleSelection: (id: string) => void;
}

/**
 * A single hairline-divided row inside the virtualized `TransactionMasterList`.
 * Renders as a `Row` (no per-item border/bg-white/rounded-card) so 90+ stacked
 * transactions read as one flat list, not 90 stacked cards. The virtualizer
 * measures the height of the ABSOLUTE-positioned wrapper `TransactionMasterList`
 * renders around this component, so row-height behavior stays unchanged.
 *
 * The merchant NAME shown here is resolved through the household's merchant
 * rules (`useMerchantRules`), never read straight off `tx.merchant` — a rule
 * relabels "APPLE.COM/BILL 866-712-7753 CA" as "Apple" at display time while the
 * stored descriptor stays untouched. The hook is called here rather than passed
 * down as a prop so the rules subscription rides the core-context subscription
 * this row already has (via `useFormatCurrency`): a rules edit re-renders every
 * mounted row directly, without widening the memo comparator below.
 *
 * The ROW BODY is the primary target (CRIT-01): outside selection mode a tap
 * opens the edit drawer, inside selection mode it toggles selection. It carries
 * `role="button"` / `role="checkbox"` accordingly plus its own `aria-label`, so
 * the accessible name is a single sentence rather than the concatenation of
 * every nested action button's label. The kebab / hover actions stay as the
 * secondary path and `stopPropagation` so they never double-fire the row.
 *
 * WHERE that role sits differs per mode, and deliberately so (same pattern as
 * `components/todos/TodoRow.tsx` — read its comments before changing this):
 * - NORMAL mode renders 1-5 real `<button>` action controls, so the
 *   `role="button"` target is an INNER element sized to the non-button content
 *   (identity + amount) and the action cluster is its SIBLING. ARIA forbids
 *   interactive descendants of `role="button"`, and putting the role on the
 *   whole row gave a keyboard user 2-5 tab stops per row in a 100-row
 *   virtualized list — with the hover "Edit" button firing the exact same
 *   `onEdit(tx)` as the element containing it.
 * - SELECTION mode hides every action button, so there is nothing interactive
 *   to nest and the role sits on the row itself (`role="checkbox"` +
 *   `aria-checked`), keeping the whole row the tap target for bulk select.
 */
export const TransactionItem = memo(({ transaction: tx, onEdit, onDelete, onDuplicate, onSplit, onMore, isSelectionMode, isSelected, onToggleSelection }: TransactionItemProps) => {
  const fmt = useFormatCurrency();
  const { displayNameFor } = useMerchantRules();
  const merchantName = displayNameFor({ merchant: tx.merchant, amount: tx.amount });
  const isIncome = tx.category === INCOME_CATEGORY;

  const activate = () => {
    if (isSelectionMode) onToggleSelection(tx.id);
    else onEdit(tx);
  };

  // The row's own accessible name. It carries the expense/income distinction in
  // words, which is why the leading glyph below can be purely decorative — the
  // arrow direction and the amount's "+" sign are visual cues only.
  const rowLabel = `${isSelectionMode ? 'Select' : 'Edit'} ${isIncome ? 'income' : 'expense'} of ${fmt(tx.amount)} from ${sanitizeMerchantName(merchantName)}, ${format(parseISO(tx.date), 'MMM d, yyyy')}`;

  // A `role="button"` / `role="checkbox"` div gets no free keyboard activation,
  // so Enter/Space are handled explicitly. `preventDefault` stops Space from
  // scrolling the virtualized list under the focused row.
  const handleActivationKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      activate();
    }
  };

  const focusRing =
    'focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40 focus-visible:ring-inset';

  // Exactly ONE interactive-role attribute set per row, moved between the two
  // hosts by mode (see the component doc above): the Row in selection mode, the
  // inner body in normal mode. It is never applied to both — that would be two
  // tab stops for one action.
  const targetProps = {
    onClick: activate,
    onKeyDown: handleActivationKeyDown,
    tabIndex: 0,
    'aria-label': rowLabel,
    role: isSelectionMode ? ('checkbox' as const) : ('button' as const),
    'aria-checked': isSelectionMode ? isSelected : undefined,
  };

  return (
    // `interactive` paints `hover:bg-* cursor-pointer` on the Row, so it may only
    // be set in the mode where the Row ITSELF activates. Outside selection mode
    // the handlers sit on the body below, and a hard-coded `interactive` tinted
    // and pointer-cursored the Row's own `px-4` gutters and the `gap-3` beside
    // the action cluster — surfaces that promise a tap and then swallow it,
    // which is the exact defect this row was restructured to remove. The
    // affordance travels WITH the handlers (same rule as
    // `components/todos/TodoRow.tsx`): hovered surface == clickable surface.
    <Row
      interactive={isSelectionMode}
      {...(isSelectionMode ? targetProps : {})}
      className={cn(
        'justify-between group',
        isSelectionMode && focusRing,
        isSelected && 'bg-brand-50 dark:bg-brand-700/40'
      )}
    >
      {/* Row body — identity + amount, i.e. everything that is NOT a control.
          In normal mode this is the `role="button"` target; the action cluster
          below is its sibling, so the subtree hosting the role contains no
          focusable descendant and the row keeps a single tab stop. It therefore
          also carries the hover tint + pointer cursor in that mode (the Row
          carries them in selection mode) — the affordance marks exactly the box
          that handles the click, never a millimetre more. Only paint properties
          are added here (`bg`/`cursor`/`border-radius`/`transition`), so the
          box the virtualizer measures is byte-for-byte the one it measured
          before. */}
      <div
        {...(isSelectionMode ? {} : targetProps)}
        className={cn(
          'flex flex-1 min-w-0 items-center justify-between gap-3 text-left',
          !isSelectionMode && [
            focusRing,
            'cursor-pointer rounded-btn transition-colors duration-(--duration-fast) ease-(--ease-standard) hover:bg-brand-50 dark:hover:bg-brand-700/40',
          ]
        )}
      >
        <div className="flex items-center gap-3 overflow-hidden">
          {/* Selection checkbox — decorative. The row itself is the `checkbox`
              (role + aria-checked + aria-label above), so exposing this node too
              would announce the state twice. */}
          {isSelectionMode && (
            <div
              aria-hidden="true"
              className={`shrink-0 transition-colors ${isSelected ? 'text-accent-700 dark:text-accent-300' : 'text-brand-300 dark:text-brand-500'}`}
            >
              {isSelected ? <CheckSquare size={20} /> : <div className="w-5 h-5 border-2 border-current rounded-md" />}
            </div>
          )}

          {/* Category glyph — a bare icon, NOT a bordered/filled 44x44 box. That
              treatment was dimensionally identical to `Button size="icon"` and
              read as a control the row never made it. Decorative: the row's
              aria-label already says "income"/"expense". */}
          <div
            aria-hidden="true"
            className={`w-6 flex items-center justify-center shrink-0 ${
              isIncome
                ? 'text-money-pos dark:text-money-posDark'
                : 'text-brand-400 dark:text-brand-450'
            }`}
          >
            {isIncome ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />}
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-semibold tracking-tight text-brand-900 dark:text-brand-100 truncate text-base">{merchantName}</p>
              {getSourceIcon(tx.source, tx.isRecurring)}
            </div>
            {/* Optional "what was bought" note — a quiet one-line subtitle. The
                virtualizer measures rows dynamically (measureElement), so the
                extra line is safe. */}
            {tx.notes && (
              <p className="text-xs text-brand-400 dark:text-brand-450 truncate">{tx.notes}</p>
            )}
            {/* flex-wrap below sm: dot+label pairs stay together (no stranded trailing
                dot on wrap); each leaf span owns its own `truncate min-w-0` because
                truncate on a flex container clips children mid-word. */}
            <p className="text-xs font-medium text-brand-500 dark:text-brand-400 min-w-0 flex flex-wrap sm:flex-nowrap items-center gap-x-1.5 gap-y-0.5 mt-0.5">
              <span className="shrink-0 whitespace-nowrap">{format(parseISO(tx.date), 'MMM d, yyyy')}</span>
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="shrink-0 w-1 h-1 rounded-full bg-brand-300 dark:bg-brand-600" />
                <span className="truncate min-w-0 font-medium text-brand-600 dark:text-brand-300">{tx.category}</span>
              </span>
              {tx.store && (
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="shrink-0 w-1 h-1 rounded-full bg-brand-300 dark:bg-brand-600" />
                  <span className="truncate min-w-0 font-medium text-brand-600 dark:text-brand-300">{tx.store}</span>
                </span>
              )}
              {/* F-DASH-04: this row is one slice of a receipt split into several
                  categorized transactions — a purely visual grouping cue. */}
              {tx.receiptGroupId && (
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className="shrink-0 w-1 h-1 rounded-full bg-brand-300 dark:bg-brand-600" />
                  <span
                    className="inline-flex items-center gap-0.5 font-medium text-brand-600 dark:text-brand-300"
                    aria-label="Part of a split receipt"
                    title="Part of a split receipt"
                  >
                    <Scissors size={11} />
                    Split
                  </span>
                </span>
              )}
              {/* Plan 23: denormalized comment count, read-only — bumped by
                  addTransactionComment/deleteTransactionComment. */}
              {!!tx.commentCount && tx.commentCount > 0 && (
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className="shrink-0 w-1 h-1 rounded-full bg-brand-300 dark:bg-brand-600" />
                  <span
                    className="inline-flex items-center gap-0.5 font-medium text-brand-600 dark:text-brand-300"
                    aria-label={`${tx.commentCount} comment${tx.commentCount === 1 ? '' : 's'}`}
                  >
                    <MessageSquare size={11} />
                    {tx.commentCount}
                  </span>
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="text-right shrink-0 pl-2">
          <p className={`font-mono font-bold tabular-nums tracking-tight text-base ${
            isIncome ? 'text-money-pos dark:text-money-posDark' : 'text-brand-900 dark:text-brand-100'
          }`}>
            {isIncome ? '+' : ''}{fmt(tx.amount)}
          </p>
          {tx.status === 'pending_review' && (
            <Badge variant="warning" size="sm">
              Pending
            </Badge>
          )}
        </div>
      </div>

      {/* Actions — SIBLINGS of the row body above, never descendants of it, and
          HIDDEN IN SELECTION MODE. */}
      {!isSelectionMode && (
        <div className="flex shrink-0 items-center">
          {/* Desktop: Hover Actions */}
          <div className="hidden sm:flex gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => { e.stopPropagation(); onEdit(tx); }}
              className="text-brand-400 dark:text-brand-450 hover:text-brand-600 dark:hover:text-brand-300 hover:bg-brand-50 dark:hover:bg-brand-700/50 rounded-btn"
              aria-label={getSanitizedLabel(merchantName, 'Edit')}
            >
              <Edit size={16} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => { e.stopPropagation(); onDuplicate(tx); }}
              className="text-brand-400 dark:text-brand-450 hover:text-brand-600 dark:hover:text-brand-300 hover:bg-brand-50 dark:hover:bg-brand-700/50 rounded-btn"
              aria-label={getSanitizedLabel(merchantName, 'Duplicate')}
            >
              <Copy size={16} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => { e.stopPropagation(); onSplit(tx); }}
              className="text-brand-400 dark:text-brand-450 hover:text-brand-600 dark:hover:text-brand-300 hover:bg-brand-50 dark:hover:bg-brand-700/50 rounded-btn"
              aria-label={getSanitizedLabel(merchantName, 'Split')}
            >
              <Scissors size={16} />
            </Button>
            <Button
              variant="ghost-destructive"
              size="icon"
              onClick={(e) => { e.stopPropagation(); onDelete(tx); }}
              className="text-brand-400 dark:text-brand-450 hover:text-money-neg dark:hover:text-money-negDark hover:bg-money-bgNeg dark:hover:bg-money-neg/15 rounded-btn"
              aria-label={getSanitizedLabel(merchantName, 'Delete')}
            >
              <Trash2 size={16} />
            </Button>
          </div>

          {/* Mobile: More Button */}
          {onMore && (
            <div className="flex sm:hidden">
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => { e.stopPropagation(); onMore(tx); }}
                className="text-brand-400 dark:text-brand-450 active:bg-brand-100 dark:active:bg-brand-700/50 rounded-btn"
                aria-label={getSanitizedLabel(merchantName, 'More options')}
              >
                <MoreVertical size={20} />
              </Button>
            </div>
          )}
        </div>
      )}
    </Row>
  );
}, (prevProps, nextProps) => {
  // Custom comparator to handle reference instability from Firestore.
  // `merchant` + `amount` are both compared below, which covers every PROP input
  // to the merchant-rule lookup; the rules themselves arrive via context, and a
  // context change re-renders this component regardless of this comparator.
  const p = prevProps.transaction;
  const n = nextProps.transaction;

  return (
    p.id === n.id &&
    p.amount === n.amount &&
    p.merchant === n.merchant &&
    p.category === n.category &&
    p.date === n.date &&
    p.status === n.status &&
    p.source === n.source &&
    p.isRecurring === n.isRecurring &&
    p.store === n.store &&
    p.notes === n.notes &&
    p.commentCount === n.commentCount &&
    p.receiptGroupId === n.receiptGroupId &&
    // Ignored props: payPeriodId, autoCategorized, relatedHabitIds
    // These fields do not affect the rendering of this component.
    // Excluding them prevents unnecessary re-renders when backend-only fields change
    // or when Firestore returns new array references for relatedHabitIds.
    prevProps.onEdit === nextProps.onEdit &&
    prevProps.onDelete === nextProps.onDelete &&
    prevProps.onDuplicate === nextProps.onDuplicate &&
    prevProps.onSplit === nextProps.onSplit &&
    prevProps.onMore === nextProps.onMore &&
    prevProps.isSelectionMode === nextProps.isSelectionMode &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.onToggleSelection === nextProps.onToggleSelection
  );
});

TransactionItem.displayName = 'TransactionItem';
