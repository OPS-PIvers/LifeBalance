# Sentinel's Journal

## 2025-02-23 - Initial Security Baseline
**Vulnerability:** Missing standard security headers (HSTS, X-Frame-Options, X-Content-Type-Options) in `firebase.json`.
**Learning:** Default Firebase Hosting configuration provides caching headers but lacks active security hardening headers, leaving the app potentially vulnerable to clickjacking and MIME sniffing.
**Prevention:** Always explicitly configure `headers` in `firebase.json` (for example, using a `"source": "**"` rule so they apply to all hosted files, including `index.html`) to enforce browser-side security protections.

## 2025-02-24 - Gemini Prompt Injection Mitigation
**Vulnerability:** User-controlled inputs (`availableCategories`, `availableHabits`) were being directly injected into Gemini AI prompts via `.join(', ')`. This allowed potential Prompt Injection if a user created a category/habit with malicious instructions (e.g., "Ignore previous...").
**Learning:** Even "trusted" user data like categories should be sanitized when constructing LLM prompts, as they become part of the instruction context.
**Prevention:** Apply `sanitizeForPrompt` (removing quotes, newlines) to all dynamic list items before injecting them into prompt strings.
