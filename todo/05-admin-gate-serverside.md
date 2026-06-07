# Handoff: Move the beta-access / admin gate server-side

**Status:** Not started · **Priority:** Medium (security) · **Risk:** Medium (auth behavior change)

---

## Problem

Access control is enforced **client-side** using `VITE_ADMIN_UID`, which Vite inlines into the
JavaScript bundle at build time. The admin's Firebase UID is therefore visible in any production
build, and the "Private Alpha" gating for new users is only a client-side check — trivially
bypassed by anyone who edits the client or calls Firestore directly. Firestore security rules must
be the authoritative guard.

### Evidence / where to look

- `contexts/AuthContext.tsx` (~line 70): `const adminUid = import.meta.env.VITE_ADMIN_UID` — the
  beta-access gate for new users.
- `pages/Settings.tsx` (~line 74): `const isGlobalAdmin = user?.uid === import.meta.env.VITE_ADMIN_UID`
  — admin-only UI affordances.
- `deploy.yml` (~line 64): `VITE_ADMIN_UID` injected at build.

## Why this was deferred

It's a security/product decision, not a mechanical change: it requires designing the authoritative
server-side model (Firestore rules and/or a custom auth claim) and a way to manage who is an
admin / approved beta tester, plus migrating current behavior without locking anyone out.

## Proposed approach

1. **Authoritative gate in Firestore rules.** Represent approved users as a `beta_testers`
   collection (or a custom claim `admin: true` / `betaApproved: true` set via the Admin SDK in a
   Cloud Function). Rules must check this for any write a non-approved user could attempt.
2. **Admin role:** prefer a Firebase **custom claim** (`admin: true`) over an env-inlined UID.
   Set it once via a secured callable/Admin script. `Settings.tsx` reads it from the decoded token
   (`getIdTokenResult()`), not from `VITE_ADMIN_UID`.
3. The client checks become *UX hints only* (hide/show), with the server enforcing truth.
4. Remove `VITE_ADMIN_UID` from the client env + `deploy.yml` once nothing reads it.

## Risks

- Misconfigured rules could lock out legitimate users or expose data — test rules with the
  emulator before deploying.
- Custom-claim propagation requires a token refresh; handle the transition for currently-signed-in
  users.

## Acceptance criteria

- New-user beta gating and admin actions are enforced by Firestore rules / custom claims, verified
  to fail for non-approved users even when calling Firestore directly.
- No Firebase UID is embedded in the client bundle for access control.
- `VITE_ADMIN_UID` removed (or demoted to a pure UX hint with server enforcement behind it).
