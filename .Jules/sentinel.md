## 2024-05-22 - [IDOR] Household Invite Code Leak
**Vulnerability:** The `householdId` (a random UUID) was effectively treated as a secret key. Knowing it allowed any authenticated user to read the `Household` document (via `allow get: if isAuthenticated()`), which revealed the `inviteCode`. The `inviteCode` then allowed the user to join the household and gain full access. This created an IDOR vulnerability where finding a household ID escalated to full membership.
**Learning:** "Hidden" IDs are not sufficient security. `allow get` on a document exposes *all* fields, including sensitive ones like `inviteCode` or `memberUids`.
**Prevention:**
1. Restrict `allow get` to members only. We used `request.auth.uid in resource.data.memberUids` to avoid an extra read cost (`exists()`).
2. Secure the `update` rule to prevent users from adding themselves to `memberUids` without first proving possession of the invite code (via creating a `members/{uid}` document first).

## 2024-06-18 - [DoS/Privilege Escalation] Unauthorized Member Management
**Vulnerability:** Regular household members could modify the `memberUids` array on the `Household` document. This allowed them to (1) remove other members (DoS) or (2) add arbitrary users to `memberUids`. Adding arbitrary users to `memberUids` granted those users READ access to the household document (and thus the invite code), bypassing the invite code check mechanism for initial access.
**Learning:** `allow update` rules must validate *content* changes, not just user identity. Membership lists control access and must be protected.
**Prevention:**
1. Restricted `memberUids` additions: Users can only add *themselves* (after they have joined properly via `members/` subcollection).
2. Restricted `memberUids` removals: Users can only remove *themselves* (leave). Only Admins can remove *others* (kick).
