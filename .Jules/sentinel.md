## 2024-05-22 - [IDOR] Household Invite Code Leak
**Vulnerability:** The `householdId` (a random UUID) was effectively treated as a secret key. Knowing it allowed any authenticated user to read the `Household` document (via `allow get: if isAuthenticated()`), which revealed the `inviteCode`. The `inviteCode` then allowed the user to join the household and gain full access. This created an IDOR vulnerability where finding a household ID escalated to full membership.
**Learning:** "Hidden" IDs are not sufficient security. `allow get` on a document exposes *all* fields, including sensitive ones like `inviteCode` or `memberUids`.
**Prevention:**
1. Restrict `allow get` to members only (`isMemberOf(householdId)`).
2. If public info (like household name) is needed for non-members, store it in a separate `public` subcollection or document with wider read permissions, keeping sensitive data in the restricted parent doc.
