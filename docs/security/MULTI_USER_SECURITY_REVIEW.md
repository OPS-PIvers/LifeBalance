# Multi-user security review before Plaid and Stripe launch

Review date: 2026-07-22

This document captures a focused security review of the current codebase before LifeBalance moves from a trusted single-developer-user model to a multi-user launch with Plaid bank linking and Stripe paywalls.

## Scope

Reviewed areas:

- Plaid Cloud Functions and client feature gating.
- Stripe Checkout and webhook functions.
- Firestore rules for household membership, server-only collections, and future collection defaults.
- Feature-flag and entitlement boundaries that matter before enabling Plaid or Stripe for users.

## Findings

### 1. Plaid callable functions bypass the `plaidEnabled` rollout flag

**Severity:** High  
**Suggested labels:** `security`, `plaid`, `launch-blocker`

#### Vulnerability

The Plaid UI is client-gated by `plaidEnabled`, but the deployed callable functions do not enforce the same flag server-side. The Plaid functions are already exported from `functions/src/index.ts`, and the comments say the UI and daily sync should only do anything after `plaidEnabled` is flipped.

However:

- `plaidcreatelinktoken` only requires authentication, a `householdId`, and household membership before creating a Plaid link token.
- `plaidexchangepublictoken` only requires authentication, a `householdId`, a `publicToken`, and household membership before exchanging and storing an access token.
- `plaiddisconnectbank` only requires authentication and household membership before deleting all Plaid items for the household.

Because callable names are bundled client-side or otherwise discoverable, and callable functions are not private, a signed-in household member can call these functions directly even when the UI is hidden.

#### Impact

Before the Plaid rollout flag is enabled, a user who can invoke callables directly could:

- Create Plaid Link tokens.
- Exchange Plaid public tokens.
- Persist server-side Plaid access tokens.
- Start incurring Plaid item costs.
- Link bank data before the product, support, and consent flows are ready.
- Disconnect all linked Plaid items for a household if they are merely a member.

#### Recommended fix

Add a server-side flag guard shared by all Plaid user-facing callables:

1. Read `app_config/global`.
2. Allow only if either:
   - `plaidEnabled === true`, or
   - `plaidEnabledHouseholds` contains the requested household id, if the allowlist is intended to apply server-side too.
3. Fail closed on missing config or read error.
4. Add tests proving:
   - Calls fail while the flag is off.
   - Calls fail on config read errors.
   - Calls pass when globally enabled.
   - Calls pass when the household is allowlisted.
5. Consider whether disconnect should be admin-only or link-owner/admin-only; currently any member can disconnect every Plaid item in the household.

---

### 2. Stripe Checkout accepts caller-controlled redirect URLs without origin allowlisting

**Severity:** Medium / High before billing launch  
**Suggested labels:** `security`, `stripe`, `launch-blocker`

#### Vulnerability

`createcheckoutsession` accepts `successUrl` and `cancelUrl` directly from callable input, validates only that `successUrl` is a non-empty string, and forwards both values into Stripe Checkout.

The function correctly requires the caller to be a household admin before creating a session. However, once Stripe billing is exported/deployed, a malicious or compromised household admin session could create a legitimate LifeBalance Stripe Checkout session that redirects to an attacker-controlled site after success or cancellation.

#### Impact

This can enable phishing or post-payment confusion:

- A user completes payment on a legitimate Stripe-hosted checkout page.
- Stripe redirects them to a malicious `successUrl`.
- The malicious site can impersonate LifeBalance, ask for credentials, claim payment failed, or trick the user into additional actions.

Even though this requires an authenticated household admin, billing flows deserve stricter redirect controls because they involve payment trust boundaries.

#### Recommended fix

Server-side allowlist redirect origins before creating Checkout sessions:

- Permit only known production and preview/development origins as appropriate.
- Prefer deriving `success_url` and `cancel_url` server-side from trusted config instead of trusting client input.
- Reject non-HTTPS URLs except localhost or emulator development if needed.
- Add unit tests for:
  - trusted production origin accepted,
  - localhost/development origin accepted only in emulator/development mode,
  - attacker domain rejected,
  - malformed URL rejected,
  - scheme-relative, `javascript:`, and data URLs rejected.

---

### 3. Firestore catch-all rule grants member read/write access to future unmodeled subcollections

**Severity:** High  
**Suggested labels:** `security`, `firestore-rules`, `launch-blocker`

#### Vulnerability

The Firestore rules include a catch-all for any household subcollection that does not have an explicit block. It grants reads to any household member except for `apiKeys` and `plaidItems`, and grants writes to any household member unless the subcollection is listed in a growing denylist.

This is a risky default for a multi-user app moving into payments and bank integrations. Any newly added subcollection under `households/{householdId}` is automatically readable and possibly writable by all household members unless developers remember to add it to this denylist.

#### Impact

Future data could be exposed or tampered with by default, including:

- Billing/customer metadata accidentally stored under a new household subcollection.
- Plaid account mapping or sync metadata if introduced under a differently named collection.
- Private per-member settings.
- Operational audit records.
- Any new feature data that should be admin-only, owner-only, server-only, or append-only.

The current catch-all is especially dangerous because the denylist model fails open for new collections.

#### Recommended fix

Invert the default:

- Replace the catch-all read/write allow with `allow read, write: if false`.
- Add explicit rules for every legitimate household subcollection.
- For any intentionally generic or future extension collection, create a narrow, validated rule with a clear schema and access model.
- Add a rules test proving an unknown subcollection is denied for read and write.
- Add a policy note to `CLAUDE.md` requiring all new Firestore collections to ship with explicit rules and emulator tests.

---

### 4. Invite-based member creation is under-validated and invite codes are non-expiring bearer credentials

**Severity:** Medium / High before open signup  
**Suggested labels:** `security`, `firestore-rules`, `multi-user`

#### Vulnerability

A user can create their own member document by presenting an invite code whose `inviteCodes/{code}` doc points at the household. The rule blocks self-assigned `role: 'admin'`, but it does not otherwise validate the member document schema, allowed keys, string lengths, or server-managed fields in that invite path.

The household update rule then allows a member to add themself to `memberUids` once they have a member doc, which is the intended join flow.

Invite documents cannot be updated or deleted by clients, and the visible rules do not enforce expiration, single-use behavior, household admin revocation, or max-use semantics.

#### Impact

If an invite code leaks or is guessed/brute-forced offline from logs, screenshots, or messages, it can remain a long-lived bearer credential for joining a household.

The under-validated member-create path could also allow storage abuse or confusing member records with unexpected fields, especially as the app opens beyond a trusted single-dev-user context.

#### Recommended fix

Strengthen membership join semantics:

- Add a strict validator for login-backed member documents:
  - allowed keys only,
  - required `uid === request.auth.uid`,
  - `displayName` length cap,
  - email/photo URL caps,
  - `role` must be absent or a safe non-admin role on invite join,
  - no client-written points, entitlement, or server-only fields unless explicitly intended.
- Add invite lifecycle controls:
  - expiration timestamp,
  - revocation,
  - max uses / used count,
  - optional admin-only regeneration.
- Consider moving invite redemption into a callable Cloud Function with a transaction:
  - validate invite,
  - create member doc,
  - append `memberUids`,
  - increment invite use count,
  - enforce member cap atomically.
- Add emulator tests covering malformed member docs, expired/revoked invites, and cap enforcement.

## Additional observations

- The CSP is currently configured as `Content-Security-Policy-Report-Only`, not enforced. It also allows `'unsafe-inline'` scripts. That is not necessarily a launch blocker if intentional during development, but it weakens XSS defense-in-depth for a finance app.
- The Stripe functions are still dormant because they are not exported from `functions/src/index.ts`, which reduces immediate exposure. The redirect issue becomes relevant when they are exported for billing launch.
- Plaid access tokens are correctly stored server-side under `plaidItems`, and Firestore rules explicitly deny client access to that subcollection.

## Review limitations

GitHub issues were not created from the review environment because it had no GitHub CLI, no configured `origin` remote, and no GitHub token or issue-creation tool available. The findings above are written in issue-ready format so they can be copied into GitHub issues or used to create issues through a later authenticated workflow.
