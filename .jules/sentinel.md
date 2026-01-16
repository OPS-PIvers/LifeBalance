# Sentinel's Journal

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
