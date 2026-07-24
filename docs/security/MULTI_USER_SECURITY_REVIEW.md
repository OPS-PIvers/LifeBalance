# Multi-user security review before Plaid and Stripe launch

Review date: 2026-07-22 · Re-verified against `main` @ `c9f9351` on 2026-07-24

This document captures a focused security review of the current codebase before LifeBalance moves from
a trusted single-developer-user model to a multi-user launch with Plaid bank linking and Stripe paywalls.

## Scope

Reviewed areas:

- Plaid Cloud Functions and client feature gating.
- Stripe Checkout and webhook functions.
- Firestore rules for household membership, server-only collections, and future collection defaults.
- Feature-flag and entitlement boundaries that matter before enabling Plaid or Stripe for users.

**Not** reviewed — out of scope for this pass, and each still worth its own look before launch:

- The `quickAdd` HTTP surface (API-key auth, rate limiting, CORS) — partially covered by the 2026-06
  audit items in [`TODO.md`](../../TODO.md) §2B.
- `fetchrecipepage` SSRF guards; the dormant `apiKeys` reveal functions.
- Dependency/supply-chain audit; live penetration testing.
- Emulator execution of the rules — every rules claim below is from **static reading** of
  [`firestore.rules`](../../firestore.rules), not from an emulator run. `pnpm test:rules` is CI-only
  (the Firestore emulator does not run on the dev Windows box), so any rules change proposed here needs
  its test written and verified in CI.

## Findings

### 1. Plaid callable functions bypass the `plaidEnabled` rollout flag

**Severity:** High
**Suggested labels:** `security`, `plaid`, `launch-blocker`

#### Vulnerability

The Plaid UI is client-gated by `plaidEnabled`, but the deployed callable functions do not enforce the
same flag server-side. The Plaid functions are already exported from `functions/src/index.ts`, and the
comment there says the UI and daily sync should only do anything after `plaidEnabled` is flipped.

However, each callable's only gate is authentication + household membership
(`assertHouseholdMember` in `functions/src/plaid/client.ts`):

- `plaidcreatelinktoken` ([`functions/src/plaid/links.ts:17`](../../functions/src/plaid/links.ts)) — requires
  auth, a `householdId`, and membership before creating a Plaid link token.
- `plaidexchangepublictoken` ([`functions/src/plaid/exchange.ts:21`](../../functions/src/plaid/exchange.ts)) —
  requires auth, a `householdId`, a `publicToken`, and membership before exchanging and storing an access token.
- `plaiddisconnectbank` ([`functions/src/plaid/disconnect.ts:23`](../../functions/src/plaid/disconnect.ts)) —
  requires auth and membership before deleting all Plaid items for the household.

Because callable names are bundled client-side or otherwise discoverable, and callable functions are not
private, a signed-in household member can call these functions directly even when the UI is hidden.

Note this holds **regardless of the flag's current live value**: enforcement is client-side only, so the
flag controls what the UI renders, never what the deployed callables accept.

The scheduled `plaidsynctransactions` ([`functions/src/plaid/sync.ts`](../../functions/src/plaid/sync.ts))
does not check the flag either, but it is inert on its own — it iterates a collection-group query over
active `plaidItems`, which only exist once `plaidexchangepublictoken` has created one. Gating the
**exchange** callable is therefore the load-bearing fix; the sync follows from it.

#### Impact

Before the Plaid rollout flag is enabled, a user who can invoke callables directly could:

- Create Plaid Link tokens.
- Exchange Plaid public tokens.
- Persist server-side Plaid access tokens.
- Start incurring Plaid item costs (free up to 10 lifetime Items, then ~$0.30/Item/month).
- Link bank data before the product, support, and consent flows are ready.
- Disconnect all linked Plaid items for a household if they are merely a member.

#### Recommended fix

Add a server-side flag guard shared by all Plaid user-facing callables.
[`functions/src/geminiProxy.ts`](../../functions/src/geminiProxy.ts) is the in-repo precedent for exactly
this shape — it reads `app_config/global`, honors the `aiEnabled` kill-switch, and enforces the quota
**before** spending the server-side secret. Mirror it:

1. Read `app_config/global`.
2. Allow only if either:
   - `plaidEnabled === true`, or
   - `plaidEnabledHouseholds` contains the requested household id. That per-household allowlist already
     exists **client-side** ([`services/appConfig.ts`](../../services/appConfig.ts),
     [`hooks/usePlaidEnabled.ts`](../../hooks/usePlaidEnabled.ts)); decide explicitly whether it should
     also apply server-side, and keep the two in sync if so.
3. Fail closed on missing config or read error. (Note this is the **opposite** of `aiEnabled`, which is
   deliberately fail-open — `plaidEnabled` is fail-closed everywhere client-side today and the server
   guard should match.)
4. Add tests proving:
   - Calls fail while the flag is off.
   - Calls fail on config read errors.
   - Calls pass when globally enabled.
   - Calls pass when the household is allowlisted.
5. Consider whether disconnect should be admin-only or link-owner/admin-only; currently any member can
   disconnect every Plaid item in the household.

---

### 2. Stripe Checkout accepts caller-controlled redirect URLs without origin allowlisting

**Severity:** Medium / High before billing launch
**Suggested labels:** `security`, `stripe`, `launch-blocker`

#### Vulnerability

`createcheckoutsession` ([`functions/src/stripe/checkout.ts:28`](../../functions/src/stripe/checkout.ts))
accepts `successUrl` and `cancelUrl` directly from callable input and forwards both into Stripe Checkout.
`successUrl` is validated only as a non-empty string; `cancelUrl` gets **no** validation at all beyond a
`typeof === 'string'` truthiness check that decides whether to forward it. Neither is parsed, scheme-checked,
or origin-checked.

The function correctly requires the caller to be a household admin before creating a session. However,
once Stripe billing is exported/deployed, a malicious or compromised household admin session could create a
legitimate LifeBalance Stripe Checkout session that redirects to an attacker-controlled site after success
or cancellation.

#### Impact

This can enable phishing or post-payment confusion:

- A user completes payment on a legitimate Stripe-hosted checkout page.
- Stripe redirects them to a malicious `successUrl`.
- The malicious site can impersonate LifeBalance, ask for credentials, claim payment failed, or trick the
  user into additional actions.

Even though this requires an authenticated household admin, billing flows deserve stricter redirect
controls because they involve payment trust boundaries.

#### Recommended fix

Server-side allowlist redirect origins before creating Checkout sessions:

- Permit only known production and preview/development origins as appropriate.
- Prefer deriving `success_url` and `cancel_url` server-side from trusted config instead of trusting
  client input.
- Reject non-HTTPS URLs except localhost or emulator development if needed.
- Add unit tests for:
  - trusted production origin accepted,
  - localhost/development origin accepted only in emulator/development mode,
  - attacker domain rejected,
  - malformed URL rejected,
  - scheme-relative, `javascript:`, and data URLs rejected.

This is cheap to land now: the Stripe functions are **not exported** from `functions/src/index.ts`, so the
fix carries zero deployment risk today and removes a launch-day blocker. It must land **before** the export
step in [`docs/STRIPE_SETUP_RUNBOOK.md`](../STRIPE_SETUP_RUNBOOK.md).

---

### 3. Firestore catch-all rule grants member read/write access to future unmodeled subcollections

**Severity:** High
**Suggested labels:** `security`, `firestore-rules`, `launch-blocker`

> **Already tracked** as **SEC-10** in [`TODO.md`](../../TODO.md) §2B ("catch-all subcollection write rule
> … Change to deny-by-default", sized **S / LOW-MED**). This review **raises** that severity rather than
> filing a duplicate: the item was scoped when LifeBalance was single-household and pre-payments. File
> follow-up work against SEC-10.

#### Vulnerability

The Firestore rules include a catch-all for any household subcollection that does not have an explicit
block ([`firestore.rules`](../../firestore.rules), the `match /{subcollection}/{document}` block near the
end of the `households/{householdId}` scope). It grants reads to any household member except for `apiKeys`
and `plaidItems`, and grants writes to any household member unless the subcollection is listed in a
growing denylist (23 entries at time of review).

This is a risky default for a multi-user app moving into payments and bank integrations. Any newly added
subcollection under `households/{householdId}` is automatically readable and possibly writable by all
household members unless developers remember to add it to this denylist.

#### Impact

Future data could be exposed or tampered with by default, including:

- Billing/customer metadata accidentally stored under a new household subcollection.
- Plaid account mapping or sync metadata if introduced under a differently named collection.
- Private per-member settings.
- Operational audit records.
- Any new feature data that should be admin-only, owner-only, server-only, or append-only.

The current catch-all is especially dangerous because the denylist model fails open for new collections.
The denylist is also load-bearing in a non-obvious way: Firestore grants access if **any** rule allows, so
a deny-only explicit block (like `plaidItems`) is not sufficient on its own — the subcollection must
*also* be excluded from the catch-all. The rules file already carries a comment saying so; that coupling
is exactly what makes the pattern fragile.

A related current surface exists in the explicit `activityLog` rule: members can create audit-log entries
(`allow create: if isMemberOf(householdId)`), but there is no schema validation for the entry body. Because
updates and deletes are denied, a poisoned or oversized audit-log entry cannot be corrected by clients after
creation. That is better than editable audit history, but it leaves unbounded append as the remaining
audit-log abuse path.

#### Recommended fix

Invert the default:

- Replace the catch-all read/write allow with `allow read, write: if false`.
- Add explicit rules for every legitimate household subcollection. (Enumerate them by grepping every
  `.collection()` / `collection(db, …)` call site first, as SEC-10 already notes, so nothing untracked breaks.)
- For any intentionally generic or future extension collection, create a narrow, validated rule with a
  clear schema and access model.
- Add a rules test proving an unknown subcollection is denied for read and write.
- Add explicit `activityLog` create validation:
  - allowed keys only,
  - required `actorUid === request.auth.uid`,
  - bounded action/type strings,
  - bounded optional detail text,
  - server timestamp semantics for created-at fields,
  - optional resource ids capped to safe lengths.
- Add a policy note to `CLAUDE.md` requiring all new Firestore collections to ship with explicit rules and
  emulator tests.

Bundle this with the two other open rules items in `TODO.md` §2B — **SEC-06** (missing `logs/api_calls/requests`
rule) and the dead `subBucketId`/`subBuckets` cleanup — so the rules surface is touched once.

---

### 4. Invite-based member creation is under-validated, and invite codes cannot be revoked or expired

**Severity:** Medium / High before open signup
**Suggested labels:** `security`, `firestore-rules`, `multi-user`

#### Vulnerability

**Under-validated member create.** A user can create their own member document by presenting an invite code
whose `inviteCodes/{code}` doc points at the household. The rule blocks self-assigned `role: 'admin'`, but
it does not otherwise validate the member document schema, allowed keys, string lengths, or server-managed
fields in that invite path. (Contrast the sibling managed-kid path in the same block, which *does* enforce
`keys().hasOnly([...])` plus per-field validators — the login-backed invite path has no equivalent.)

Notably `points` is unconstrained on that path, and that is not a theoretical field: `member.points` is the
member's personal balance for rewards and allowance redemption (see `hooks/useHabitActions.tsx`, which
credits an assignee's `member.points` rather than the shared household pool, and the kid-redemption path
that spends it). A joiner can therefore seed their own member doc with an arbitrary `points.total` and
redeem real rewards against points they never earned.

What makes this a clear inconsistency rather than a judgement call: the members **update** rule already
protects `points` deliberately — a member editing their own doc is restricted to
`hasOnly(['displayName', 'email', 'photoURL', 'telegramChatId', 'notificationPreferences', 'fcmTokens',
'lastTokenRefresh'])`, which excludes `points`. So points are locked *after* join and wide open *at* join.
The create path is the only hole in an otherwise-closed control.

The household update rule then allows a member to add themself to `memberUids` once they have a member doc,
which is the intended join flow.

**No revocation path.** Invite codes are effectively permanent bearer credentials, and this is stronger than
"they don't expire" — *no client can rotate one at all*:

- `inviteCodes/{code}` is `allow update, delete: if false`.
- `inviteCode` is in the household document's immutable-field list on update
  (`!…affectedKeys().hasAny(['createdBy', 'createdAt', 'inviteCode'])`).

So a household **admin** who learns their code has leaked has no in-app remedy — revocation today requires
Admin-SDK intervention. There is likewise no expiry, use-count, or max-use enforcement.

**On guessability (corrected).** Codes are 6 characters over `[A-Z0-9]` (36⁶ ≈ 2.18 × 10⁹), generated with
`crypto.getRandomValues` plus rejection sampling to avoid modulo bias
([`utils/inviteCodeGenerator.ts`](../../utils/inviteCodeGenerator.ts)). The keyspace and the RNG are sound,
and there is **no offline oracle** — `inviteCodes/{code}` is `allow get: if isAuthenticated()` with `list`
denied, so probing is online, one authenticated Firestore read per guess, and each guess only hits a code
that has actually been issued. Guessability is therefore *not* the weak point. **Leak plus permanence is.**

#### Impact

If an invite code leaks — a screenshot, a forwarded message, a shared chat, a support ticket, a former
household member who still remembers it — it grants household join access **forever**, and no one but an
operator with Admin-SDK access can turn it off. Since joining yields full member read/write across household
finance data, that is a durable, unrevocable grant.

The under-validated member-create path could also allow storage abuse or confusing member records with
unexpected fields (including self-seeded `points`), especially as the app opens beyond a trusted
single-dev-user context.

#### Recommended fix

Strengthen membership join semantics:

- Add a strict validator for login-backed member documents, mirroring the managed-kid validator already in
  the same rules block:
  - allowed keys only (`keys().hasOnly([...])`),
  - required `uid === request.auth.uid`,
  - `displayName` length cap,
  - email/photo URL caps,
  - `role` must be absent or a safe non-admin role on invite join,
  - no client-written points, entitlement, or server-only fields unless explicitly intended.
- Add invite lifecycle controls — **revocation is the highest-value one**, since it is the only listed gap
  with no workaround short of Admin-SDK access:
  - admin-initiated rotation/revocation,
  - expiration timestamp,
  - max uses / used count.
- Consider moving invite redemption into a callable Cloud Function with a transaction:
  - validate invite,
  - create member doc,
  - append `memberUids`,
  - increment invite use count,
  - enforce the member cap atomically.
- Add emulator tests covering malformed member docs, expired/revoked invites, and cap enforcement.

**On the member cap specifically:** a plan-aware cap already exists server-side — `withinMemberCap()` in the
household update rule (Plan 051) rejects any update that grows `memberUids` past the plan limit, and
`planMaxMembers()` reads the immutable `subscription` field on the same doc. Two real gaps remain: it is a
no-op while `billingEnabled` is `false`, and it guards only the `memberUids` growth, not the
`members/{memberId}` create that precedes it — so member *documents* can accumulate past the cap even when
the roster array cannot. Treat the recommendation above as **extending** `withinMemberCap()`, not building
it from scratch.

## Additional observations

### Gaps

- **CSP is Report-Only.** [`firebase.json`](../../firebase.json) sets `Content-Security-Policy-Report-Only`,
  not an enforcing header, and it allows `'unsafe-inline'` scripts. Not necessarily a launch blocker if
  intentional during development, but it weakens XSS defense-in-depth for a finance app. Already tracked:
  `TODO.md` §1.6 and [`docs/PRELAUNCH_CHECKLIST.md`](../PRELAUNCH_CHECKLIST.md) §E item 004.
- **`geminiproxy` is an unallowlisted model relay.** The proxy enforces membership, the `aiEnabled`
  kill-switch, and an atomic daily quota (good — see below), but it forwards a caller-supplied `model` string
  and arbitrary `contents`/`config` to Gemini with no allowlist. Because the cap counts **requests**, not
  tokens or model tier, a member can point the household's daily allotment at an arbitrarily expensive model
  on the operator's key. Bounded (member-only, count-capped, kill-switchable) but worth an allowlist —
  `GEMINI_MODEL` is already a single constant client-side, and the client always sends exactly that, so
  the server fix is **one line**: ignore the caller's `model` and use the server's own constant (or
  allowlist the single permitted value). Cheap enough that it should not queue behind the larger
  findings. **Low-Medium.**

### Controls that already hold (verified — do not re-scope work here)

These matter for accurate scoping: several plausible multi-user findings are already closed server-side, and
they are the pattern the Plaid callables in Finding 1 should follow.

- **Subscription state is server-truth.** Clients cannot self-grant premium: the household `create` rule
  rejects any doc carrying a `subscription` key, and the `update` rule denies any write touching
  `subscription`. Only the Stripe webhook (Admin SDK, which bypasses rules) can set it.
- **AI quota is enforced server-side, twice.** The `geminiproxy` callable does membership + kill-switch +
  atomic check-and-increment in one Firestore transaction *before* spending the key, and independently the
  household rules constrain `aiUsage` writes to same-day `+1` or a strict new-day reset to `1` — so the
  counter cannot be rolled back from a client. `resolveQuotaDay()` also clamps a caller-supplied `today` to
  ±1 day of server UTC with monotonic rollover, closing the alternate-dates bypass.
- **Plaid access tokens never reach a client.** They are stored under `households/{id}/plaidItems`, which is
  `allow read, write: if false` **and** excluded from the catch-all read (both are required — see Finding 3).
- **Stripe functions are dormant.** They are deliberately not exported from `functions/src/index.ts`, which
  reduces immediate exposure. Finding 2 becomes live at the export step, not before.
- **Invite-code enumeration is blocked.** `inviteCodes` denies `list`; only `get` by exact id is permitted.

## Method

Static review: read of [`firestore.rules`](../../firestore.rules), the `functions/src/plaid/`,
`functions/src/stripe/`, and `functions/src/geminiProxy.ts` sources, the `functions/src/index.ts` export
surface, [`firebase.json`](../../firebase.json) headers, and the client flag/entitlement layer
(`services/appConfig.ts`, `utils/entitlements.ts`). No emulator run, no live testing, no dependency audit —
see the exclusions under **Scope** above.

Findings are written in issue-ready format so they can be filed as GitHub issues directly. Where an item is
already tracked in [`TODO.md`](../../TODO.md) or [`docs/PRELAUNCH_CHECKLIST.md`](../PRELAUNCH_CHECKLIST.md),
that is called out inline — update the existing entry rather than opening a duplicate.
