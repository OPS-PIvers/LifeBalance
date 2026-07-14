import React, { useId, useMemo, useState } from 'react';
import { Users, X, Plus } from 'lucide-react';
import { HouseholdMember, SplitParticipant } from '@/types/schema';
import { Switch } from '@/components/ui/Switch';
import { Button } from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { isValidInviteEmail } from '@/utils/splitInvite';
import {
  isMemberParticipant,
  splitEvenly,
  splitParticipantKey,
  validateSplit,
} from '@/utils/settlement';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';

interface SplitExpenseEditorProps {
  /** Total (decimal-dollar) amount of the transaction being split. */
  totalAmount: number;
  /** All household members; the payer and managed kids are filtered out. */
  members: HouseholdMember[];
  /** uid of the payer (the transaction creator) — excluded from splittable members. */
  payerUid: string | undefined;
  /** Current split value (undefined ⇒ not split). */
  value: SplitParticipant[] | undefined;
  /** Emit the new split array (empty ⇒ clears the split). */
  onChange: (next: SplitParticipant[]) => void;
  disabled?: boolean;
}

/**
 * F-MONEY-13 split editor. A toggle that, when on, lets the payer assign
 * per-person shares of an expense: household members via checkboxes + editable
 * amounts, and account-less people via an email row (owner-note invite path).
 * Purely a bookkeeping overlay — it never affects any balance. Validation is
 * surfaced inline; the parent decides when to persist.
 */
const SplitExpenseEditor: React.FC<SplitExpenseEditorProps> = ({
  totalAmount,
  members,
  payerUid,
  value,
  onChange,
  disabled,
}) => {
  const fmt = useFormatCurrency();
  const emailFieldId = useId();

  const isOn = value !== undefined && value.length > 0;
  const [externalEmail, setExternalEmail] = useState('');
  const [externalName, setExternalName] = useState('');

  // Members eligible to be split with: everyone except the payer and managed
  // kids (F-MONEY-13 is explicitly adult↔adult; kid IOUs are Plan 080).
  const eligibleMembers = useMemo(
    () => members.filter(m => m.uid !== payerUid && !m.isManaged),
    [members, payerUid],
  );

  const participants = value ?? [];
  const memberShare = (uid: string): SplitParticipant | undefined =>
    participants.find(p => p.memberId === uid);
  const externalParticipants = participants.filter(p => !isMemberParticipant(p));

  const validation = validateSplit(totalAmount, participants);

  const setParticipants = (next: SplitParticipant[]) => onChange(next);

  const toggleSplit = (on: boolean) => {
    if (on) {
      // Default to an even split across the payer + all eligible members.
      const people = eligibleMembers.length;
      if (people === 0) {
        onChange([]);
        return;
      }
      const parts = splitEvenly(totalAmount, people + 1); // +1 for the payer
      // parts[0] is the payer's own share (kept, not stored); assign the rest.
      onChange(eligibleMembers.map((m, i) => ({ memberId: m.uid, shareAmount: parts[i + 1] ?? 0 })));
    } else {
      onChange([]);
    }
  };

  const toggleMember = (uid: string, checked: boolean) => {
    if (checked) {
      setParticipants([...participants, { memberId: uid, shareAmount: 0 }]);
    } else {
      setParticipants(participants.filter(p => p.memberId !== uid));
    }
  };

  const setMemberShare = (uid: string, raw: string) => {
    const amount = parseFloat(raw);
    setParticipants(
      participants.map(p =>
        p.memberId === uid ? { ...p, shareAmount: isNaN(amount) ? 0 : amount } : p,
      ),
    );
  };

  const setExternalShare = (key: string, raw: string) => {
    const amount = parseFloat(raw);
    setParticipants(
      participants.map(p =>
        splitParticipantKey(p) === key ? { ...p, shareAmount: isNaN(amount) ? 0 : amount } : p,
      ),
    );
  };

  const removeExternal = (key: string) => {
    setParticipants(participants.filter(p => splitParticipantKey(p) !== key));
  };

  const addExternal = () => {
    const email = externalEmail.trim().toLowerCase();
    if (!isValidInviteEmail(email)) return;
    if (participants.some(p => p.email?.trim().toLowerCase() === email)) return;
    setParticipants([
      ...participants,
      { email, name: externalName.trim() || undefined, shareAmount: 0 },
    ]);
    setExternalEmail('');
    setExternalName('');
  };

  const splitEvenlyNow = () => {
    const count = participants.length + 1; // + payer
    const parts = splitEvenly(totalAmount, count);
    let i = 1; // parts[0] → payer
    setParticipants(participants.map(p => ({ ...p, shareAmount: parts[i++] ?? 0 })));
  };

  return (
    <div className="rounded-xl border border-brand-100 dark:border-brand-700 bg-brand-50 dark:bg-brand-700/40 overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <Users size={18} className="text-accent-600 dark:text-accent-400 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-brand-700 dark:text-brand-100">Split this expense</p>
            <p className="text-xs text-brand-400 dark:text-brand-400">Track who owes you. Doesn’t change any balance.</p>
          </div>
        </div>
        <Switch
          checked={isOn}
          onCheckedChange={toggleSplit}
          disabled={disabled}
          aria-label="Split this expense"
        />
      </div>

      {isOn && (
        <div className="px-4 pb-4 space-y-4 border-t border-brand-100 dark:border-brand-700 pt-3">
          {eligibleMembers.length > 0 ? (
            <div className="space-y-2">
              {eligibleMembers.map(m => {
                const share = memberShare(m.uid);
                const checked = share !== undefined;
                return (
                  <div key={m.uid} className="flex items-center gap-3">
                    <label className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer">
                      <input
                        type="checkbox"
                        className="w-4 h-4 accent-accent-600"
                        checked={checked}
                        disabled={disabled}
                        onChange={e => toggleMember(m.uid, e.target.checked)}
                      />
                      <span className="text-sm text-brand-700 dark:text-brand-100 truncate">{m.displayName}</span>
                    </label>
                    {checked && (
                      <div className="w-28 shrink-0">
                        <Input
                          id={`split-share-${m.uid}`}
                          aria-label={`${m.displayName} share`}
                          type="number"
                          inputMode="decimal"
                          step="0.01"
                          value={share?.shareAmount ? String(share.shareAmount) : ''}
                          onChange={e => setMemberShare(m.uid, e.target.value)}
                          disabled={disabled}
                          placeholder="0.00"
                          icon={<span>$</span>}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-brand-400 dark:text-brand-400">
              No other household members to split with. Add someone by email below.
            </p>
          )}

          {/* External (account-less) participants */}
          {externalParticipants.length > 0 && (
            <div className="space-y-2">
              {externalParticipants.map(p => {
                const key = splitParticipantKey(p);
                return (
                  <div key={key} className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-brand-700 dark:text-brand-100 truncate">{p.name || p.email}</p>
                      <p className="text-xs text-brand-400 dark:text-brand-400 truncate">Invite {p.email}</p>
                    </div>
                    <div className="w-28 shrink-0">
                      <Input
                        id={`split-share-${key}`}
                        aria-label={`${p.name || p.email} share`}
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        value={p.shareAmount ? String(p.shareAmount) : ''}
                        onChange={e => setExternalShare(key, e.target.value)}
                        disabled={disabled}
                        placeholder="0.00"
                        icon={<span>$</span>}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeExternal(key)}
                      disabled={disabled}
                      aria-label={`Remove ${p.name || p.email}`}
                      className="p-1.5 rounded-full text-brand-400 hover:bg-brand-100 dark:hover:bg-brand-600 disabled:opacity-50"
                    >
                      <X size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Add an external person by email */}
          <div className="space-y-2">
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Input
                  id={emailFieldId}
                  label="Split with someone by email"
                  type="email"
                  autoComplete="off"
                  value={externalEmail}
                  onChange={e => setExternalEmail(e.target.value)}
                  disabled={disabled}
                  placeholder="friend@email.com"
                />
              </div>
              <Button
                type="button"
                variant="secondary"
                size="md"
                leftIcon={<Plus size={16} />}
                disabled={disabled || !isValidInviteEmail(externalEmail)}
                onClick={addExternal}
              >
                Add
              </Button>
            </div>
            <p className="text-xs text-brand-400 dark:text-brand-400">
              They’ll get an invite to settle up and join. Email delivery isn’t configured yet — invites are recorded and sent once it’s live.
            </p>
          </div>

          <div className="flex items-center justify-between gap-3 pt-1">
            <button
              type="button"
              onClick={splitEvenlyNow}
              disabled={disabled || participants.length === 0}
              className="text-xs font-semibold text-accent-600 dark:text-accent-400 hover:underline disabled:opacity-50 disabled:no-underline"
            >
              Split evenly
            </button>
            <p className="text-xs text-brand-500 dark:text-brand-300">
              You keep <span className="font-semibold tabular-nums">{fmt(Math.max(0, validation.payerRemainder))}</span>
            </p>
          </div>

          {!validation.valid && (
            <p className="text-xs font-medium text-money-neg dark:text-money-negDark">{validation.error}</p>
          )}
        </div>
      )}
    </div>
  );
};

export default SplitExpenseEditor;
