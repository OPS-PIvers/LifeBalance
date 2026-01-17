# Sentinel's Journal

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

## 2025-02-23 - Initial Security Baseline
**Vulnerability:** Missing standard security headers (HSTS, X-Frame-Options, X-Content-Type-Options) in `firebase.json`.
**Learning:** Default Firebase Hosting configuration provides caching headers but lacks active security hardening headers, leaving the app potentially vulnerable to clickjacking and MIME sniffing.
**Prevention:** Always explicitly configure `headers` in `firebase.json` (for example, using a `"source": "**"` rule so they apply to all hosted files, including `index.html`) to enforce browser-side security protections.

## 2025-02-24 - Gemini Prompt Injection Mitigation
**Vulnerability:** User-controlled inputs (`availableCategories`, `availableHabits`) were being directly injected into Gemini AI prompts via `.join(', ')`. This allowed potential Prompt Injection if a user created a category/habit with malicious instructions (e.g., "Ignore previous...").
**Learning:** Even "trusted" user data like categories should be sanitized when constructing LLM prompts, as they become part of the instruction context.
**Prevention:** Apply `sanitizeForPrompt` (removing quotes, newlines) to all dynamic list items before injecting them into prompt strings.

## 2025-02-25 - IDOR in Member Updates
**Vulnerability:** Firestore rules for `members/{memberId}` allowed `update` if `isMemberOf(householdId)`. This meant ANY household member could update ANY OTHER member's profile (DisplayName, Email, FCM Tokens, etc.), leading to potential impersonation or denial of service (notifications).
**Learning:** `isMemberOf` only checks group membership, not resource ownership. For user-specific subcollections, explicit `request.auth.uid == memberId` checks are required.
**Prevention:** Always scope write permissions to the document owner (`request.auth.uid == resource.id` or similar) unless a specific administrative override is strictly defined.
