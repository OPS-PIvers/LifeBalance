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

## 2025-02-26 - CSV Injection (Formula Injection)
**Vulnerability:** User input exported to CSV was not sanitized, allowing special characters (`=`, `+`, `-`, `@`) to be interpreted as formulas by spreadsheet software (Excel, Sheets), potentially leading to command execution or data exfiltration.
**Learning:** Export functionality often trusts data context (assuming it's just "text"), but receiving applications (like Excel) aggressively interpret cell contents. Quotes `""` alone do not prevent formula execution.
**Prevention:** Sanitize CSV exports by prepending a single quote `'` to any field starting with dangerous characters (`=`, `+`, `-`, `@`) to force the spreadsheet to treat the cell as a string literal.

## 2026-01-18 - [IDOR] Beta Tester Enumeration
**Vulnerability:** The `beta_testers` collection allowed `read` access to any authenticated user (`allow read: if isAuthenticated();`). This permitted any user to dump the entire list of beta testers, exposing their emails (Information Disclosure).
**Learning:** `allow read` (which includes `list`) on a collection without resource-based conditions enables full enumeration. For user-specific data, rules must restrict access to the specific document owner.
**Prevention:** Use `resource.data.email == request.auth.token.email` (or similar owner check) to enforce row-level security, ensuring users can only read their own data.

## 2026-01-19 - [DoS/Validation] Public Cloud Function Input
**Vulnerability:** Publicly accessible (but API key protected) Cloud Functions (`quickAdd*`) lacked input length validation, potentially allowing DoS, storage exhaustion, or cost spikes via massive strings in `merchant`, `notes`, or `category` fields.
**Learning:** Even authenticated endpoints need rigorous input validation, especially when they serve as "public" entry points (like iOS Shortcuts) where client-side validation can be bypassed or doesn't exist.
**Prevention:** Added explicit length checks and type validation for all string inputs in `functions/src/quickAdd` endpoints to reject oversized payloads before processing.

## 2026-01-20 - [DoS/Storage Exhaustion] Batch Endpoint Validation Bypass
**Vulnerability:** The `quickAddShoppingItem` batch endpoint validated the main `item` name but skipped validation for optional fields (`category`, `store`) within the batch array. An attacker could bypass the single-item checks and send massive payloads (e.g., 1MB strings) via the batch array, causing storage exhaustion or cost spikes.
**Learning:** Validating the top-level object or a single item is not enough. When processing arrays/batches, *every* field of *every* item must be rigorously validated against the same constraints as single-item endpoints.
**Prevention:** Applied strict length (max 50 chars) and type checks to `category` and `store` fields inside the batch processing loop, mirroring the single-item validation logic.

## 2026-01-25 - [DoS/Storage Exhaustion] Firestore Input Validation
**Vulnerability:** Firestore rules allowed string fields (like `displayName`, `email`, `title`, `category`, `name`) to be updated with strings of arbitrary length (up to the 1MB document limit). This could be abused for Storage Exhaustion or Denial of Service by filling documents with massive strings.
**Learning:** Client-side validation is insufficient. Database rules must strictly enforce constraints on all user-writable fields to protect the integrity and availability of the database.
**Prevention:** Implemented helper functions `isValidString` and `isValidOptionalString` in `firestore.rules` and applied them to:
- `households` (name: 50 chars on create and update)
- `members` (displayName: 50 chars, email: 100 chars, telegramChatId: 50 chars, photoURL: 500 chars, notificationPreferences.time: 10 chars, notificationPreferences.timezone: 100 chars)
- `habits` (title: 100 chars, category: 50 chars, telegramAlias: 50 chars, presetId: 50 chars)
- `shoppingList` (name: 100 chars, category: 50 chars)

## 2026-02-05 - [DoS/Data Integrity] Transaction Schema Enforcement
**Vulnerability:** The `transactions` subcollection fell under a generic wildcard match (`match /{subcollection}/{document}`) which allowed any member to write arbitrary data fields (e.g., massive strings, unexpected types) without validation. This created a risk of Storage Exhaustion (filling documents with 1MB of junk) and Data Integrity issues (saving non-numbers as amounts).
**Learning:** Generic wildcard rules are dangerous for core data collections. Specific collections must have explicit `match` blocks to enforce schema validation (types, length limits, required fields) at the database level.
**Prevention:** Added a specific `match /transactions/{transactionId}` block in `firestore.rules` to enforce:
1.  Type safety (`amount` must be number, `isRecurring` must be boolean).
2.  Length limits (`merchant` max 100 chars, `category` max 50 chars, `notes` max 500 chars).
3.  Enum validation (`status` must be 'verified' or 'pending_review').
4.  Explicitly excluded `transactions` from the generic wildcard match to ensure the new validation rules cannot be bypassed.

## 2026-02-06 - [Sensitive Data in Logs] Cloud Function Log Exposure
**Vulnerability:** Unsanitized logging of API request bodies in Cloud Functions (`quickAdd*`) exposed sensitive user data (potential passwords, tokens, PII) in plain text to the `logs/api_calls` Firestore collection.
**Learning:** Generic logging wrappers often default to full object dumping. Without explicit filtering, any field sent by the user (even unexpected ones like `password` injected into a JSON body) gets persisted forever in logs.
**Prevention:** Implemented a `sanitizeForLogging` utility in `apiKeyValidation.ts` that:
1.  Recursively traverses request bodies.
2.  Redacts values for keys matching sensitive patterns (password, token, secret, auth, creditcard, etc.).
3.  Truncates long string values (>500 chars) to prevent log flooding.

## 2026-02-06 - [DoS/Data Integrity] Accounts Schema Enforcement
**Vulnerability:** The `accounts` subcollection was covered by a generic wildcard match (`match /{subcollection}/{document}`) which allowed writing arbitrary data without schema validation. This could lead to storage exhaustion (massive strings) or data corruption (invalid types causing frontend crashes).
**Learning:** Wildcard rules are dangerous for core business data. They bypass the "whitelist" philosophy of security rules.
**Prevention:** Explicitly define `match` blocks for all core collections (`accounts`) with strict schema validation using helper functions like `isValidString` and `isValidNumber`, and explicitly exclude them from generic wildcard matches. Separate validation for create (all required fields) vs update (partial fields) to support operations like `setAccountGoal` that only update specific fields.

## 2026-01-25 - [Privilege Escalation/Data Integrity] Strict Member Profile Updates
**Vulnerability:** The Firestore rule for `members/{memberId}` updates restricted only the `role` field. This implicitly allowed users to modify *any other field* in their own member document, including sensitive fields like `points` (gamification integrity), `uid` (identity), `joinedAt` (history), and `inviteCode` (security).
**Learning:** Blacklisting sensitive fields (like `!hasAny(['role'])`) is fragile because new fields added to the schema (e.g., `points`, `isSuperUser`) are automatically mutable by default.
**Prevention:** Use a strict allowlist (whitelist) approach for update rules using `changedKeys().hasOnly([...])`. Explicitly list every field the user is permitted to update (e.g., `displayName`, `email`, `preferences`) and deny everything else by default.

## 2026-02-27 - [Security/Quota Bypass] Client-Side Quota Manipulation
**Vulnerability:** The AI usage quota (`aiUsage`) stored in the `households` document was vulnerable to manipulation by any household member. Since members had `update` permission on the document, they could reset the `dailyCount` to 0 or change the `lastResetDate` to bypass the daily limit enforcement.
**Learning:** Client-side quota enforcement relying on client-initiated updates to a shared document is insecure if the update logic is not strictly enforced by server-side rules. "Honest client" logic is not a security control.
**Prevention:** Implemented a custom validation function `isValidAiUsageUpdate` in `firestore.rules` that strictly enforces monotonic increment of the usage counter and prevents resetting it within the same day.

## 2026-03-05 - [DoS/Data Integrity] Catch-All Wildcard Rule
**Vulnerability:** A catch-all wildcard rule (`match /{subcollection}/{document}`) allowed any household member to write arbitrary data to collections like `todos`, `meals`, `buckets`, and `calendarItems`. This bypassed schema validation, allowing potential storage exhaustion (massive payloads) or data corruption (invalid types).
**Learning:** Catch-all rules are dangerous placeholders that should be replaced with explicit, schema-enforcing rules before production. They create a false sense of security by handling access control (`isMemberOf`) but ignoring data integrity.
**Prevention:**
1. Implemented explicit `match` blocks for `todos`, `meals`, `calendarItems`, `buckets`, and `groceryCatalog` with strict type and length validation.
2. Updated the catch-all rule to explicitly *exclude* these collections, ensuring the strict rules are the only valid write path.
