/**
 * Split-invite interface for F-MONEY-13 (owner note: reach people WITHOUT
 * household accounts by email so they can settle up / create an account).
 *
 * There is NO email-sending infrastructure in this repo yet (no mail provider,
 * no Firebase "Trigger Email" extension, no Cloud Function). Rather than block
 * the whole feature on that, the in-app splitting + Settle-Up flow is fully
 * functional and this module is a CLEAN, TYPED SEAM the real sender drops into
 * later. `sendSplitInvite` today records intent locally (via the caller stamping
 * `SplitParticipant.invitedAt`) and returns a `deferred` result — it never
 * pretends an email was actually delivered.
 *
 * See the PR description / orchestrator concerns for the exact infra needed to
 * make this send for real.
 */

/** A single validation-only email check (no network, no external list). */
export function isValidInviteEmail(email: string): boolean {
  const trimmed = email.trim();
  // Deliberately conservative: exactly one @, non-empty local part, a dotted
  // domain. This is a UX guard, not RFC-5322 compliance.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

export interface SplitInviteRequest {
  /** Recipient email of the account-less person the expense was split with. */
  email: string;
  /** Decimal-dollar amount this person owes the payer. */
  amount: number;
  /** Display name of the payer, for the email body ("Alex split $12 with you"). */
  payerName: string;
  /** Optional context line (merchant / what the expense was for). */
  note?: string;
  /** Currency code for formatting the amount in the eventual email. */
  currency?: string;
}

export type SplitInviteStatus =
  /** Recorded locally; no email was sent because no mail infra is wired up. */
  | 'deferred'
  /** A real provider accepted the message for delivery. */
  | 'sent'
  /** The request was rejected before any send attempt (e.g. bad email). */
  | 'rejected';

export interface SplitInviteResult {
  status: SplitInviteStatus;
  /** ISO timestamp the invite intent was recorded / dispatched. */
  at: string;
  /** Human-readable reason, primarily for `deferred` / `rejected`. */
  reason?: string;
}

/**
 * Dispatch (or, today, record the intent to dispatch) a split invite.
 *
 * STUB IMPLEMENTATION: with no mail provider configured this validates the
 * request and returns `deferred`. When email infra lands, replace the body with
 * a call to the provider / callable Cloud Function — the signature and the
 * `SplitInviteResult` contract are the stable seam and should not change.
 */
export async function sendSplitInvite(req: SplitInviteRequest): Promise<SplitInviteResult> {
  const at = new Date().toISOString();

  if (!isValidInviteEmail(req.email)) {
    return { status: 'rejected', at, reason: 'Invalid email address.' };
  }
  if (!(typeof req.amount === 'number' && isFinite(req.amount) && req.amount > 0)) {
    return { status: 'rejected', at, reason: 'Invite amount must be greater than zero.' };
  }

  // No mail infrastructure exists yet — do not claim a send. The caller stamps
  // `invitedAt` so the UI can show "invite pending" and a real backfill job can
  // later deliver these once infra is live.
  return {
    status: 'deferred',
    at,
    reason: 'Email delivery is not configured; the invite was recorded but not sent.',
  };
}
