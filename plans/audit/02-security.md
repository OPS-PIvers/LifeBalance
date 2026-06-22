# Security Audit Findings — LifeBalance

Auditor: Claude Code (claude-sonnet-4-6)  
Date: 2026-06-21  
Scope: firestore.rules, client-side auth/VITE_* usage, Cloud Functions (quickAdd HTTP API), dependency posture, production config headers.

Known/tracked items confirmed with current evidence:
- **B1** (`services/geminiService.ts:68`) — VITE_GEMINI_API_KEY in client bundle — tracked in `docs/DEPLOY_CHECKLIST.md` as intentionally gated; marked "already tracked" below.
- **B2** (`firestore.rules:31`) — hardcoded super-admin UID fallback in `isSuperAdmin()` — tracked in `docs/DEPLOY_CHECKLIST.md`; marked "already tracked" below.
- Test Mode (MockAuth/MockHousehold) — dev-only dynamic import, excluded from prod build — NOT a finding.

---

### [SEC-01] Client-side admin/beta gating: VITE_ADMIN_UID inlined into the shipped JS bundle

- **Evidence**: `contexts/AuthContext.tsx:78` — `const adminUid = import.meta.env.VITE_ADMIN_UID` drives the Private Alpha sign-in guard; `pages/Settings.tsx:90` — `const isGlobalAdmin = user?.uid === import.meta.env.VITE_ADMIN_UID` gates the Developer Console UI. The value is injected at build time (`deploy.yml:61`) so it is present verbatim in the shipped JavaScript bundle visible to any user who opens DevTools.
- `todo/05-admin-gate-serverside.md:9` explicitly acknowledges "Access control is enforced **client-side** using `VITE_ADMIN_UID`" and calls this a known gap awaiting migration.
- **Impact**: Any person who opens the network tab or `dist/` bundle can read the admin UID and know exactly which Firebase UID has super-admin Firestore write access. They cannot impersonate it (Firebase Auth prevents that), but the exposure narrows the attack surface unnecessarily. More concretely, the `isGlobalAdmin` flag in Settings is purely a *UI gate* — it controls whether the Developer Console renders, but the underlying Firestore rules (`isSuperAdmin()`) rely on a separate `admin` custom claim + the hardcoded UID fallback (SEC-02/B2). Until SEC-02 is fully resolved, leaking the admin UID to the public bundle means the hardcoded UID fallback in rules becomes trivially correlatable.
- **Effort**: M — migrate to `getIdTokenResult()` custom claim check on the client (mirrors the rules); remove `VITE_ADMIN_UID` from `deploy.yml` and `vite-env.d.ts`. Tracked plan already exists at `todo/05-admin-gate-serverside.md`.
- **Risk**: LOW — the fix is well-scoped; the only risk is missing a call site (unlikely given only 2 usages found).
- **Confidence**: HIGH (read the code, confirmed via grep).
- **Fix sketch**: Replace `import.meta.env.VITE_ADMIN_UID` checks in both files with `(await user.getIdTokenResult()).claims.admin === true`. Remove `VITE_ADMIN_UID` from `deploy.yml` env block and `vite-env.d.ts`. The Firestore rules already accept the `admin` claim — this just aligns the client with what the rules already enforce.

---

### [SEC-02] Hardcoded super-admin UID in firestore.rules — already tracked

- **Evidence**: `firestore.rules:31` — `request.auth.uid == "nmYdn3QPsNQEvniJEXW9M3lmV5e2"` is the fallback branch of `isSuperAdmin()`. Documented in `docs/DEPLOY_CHECKLIST.md` as pending removal once the `admin` custom claim is provisioned. The UID value is now in a committed file and will remain in git history permanently even after deletion.
- **Status**: Already tracked. Re-confirmed with current file/line. Not presented as novel.
- **Impact**: The fallback is functional (the account must still authenticate via Firebase Auth), but the UID is now permanently in git history. Any future credential rotation is cosmetic only — the history must be treated as burned. The `admin` custom claim path (`request.auth.token.get('admin', false) == true`) is the correct long-term gate.
- **Effort**: S (after claim provisioning, deleting two lines from rules + redeploying).
- **Risk**: LOW — removing the fallback only matters after the claim is set.
- **Confidence**: HIGH.
- **Fix sketch**: Provision `admin: true` custom claim via Admin SDK on the admin account, verify `isSuperAdmin()` works via claim alone, then delete the `|| request.auth.uid == "..."` branch and redeploy rules. Optionally rewrite git history if the repo ever goes public (the UID itself is not a secret, but it reduces noise).

---

### [SEC-03] B1 — VITE_GEMINI_API_KEY shipped in client bundle — already tracked

- **Evidence**: `services/geminiService.ts:68` — `import.meta.env.VITE_GEMINI_API_KEY` is read at runtime; Vite inlines all `VITE_*` values into the built JS. `docs/DEPLOY_CHECKLIST.md` documents this as intentionally gated with GCP API restrictions + quota caps as the mitigation.
- **Status**: Already tracked. Re-confirmed. Not presented as novel.
- **Impact**: The key is readable from any browser on the production site. Quota caps + API restrictions reduce but do not eliminate abuse risk (e.g., key reuse for similar Google API surfaces if restrictions are misconfigured).
- **Effort**: L (proxying through a Cloud Function); S for near-term mitigation (GCP Console restrictions).
- **Risk**: LOW to MED (existing mitigation reduces blast radius).
- **Confidence**: HIGH.
- **Fix sketch**: Near-term: confirm GCP API key is restricted to the production domain referrer + Gemini API only + daily quota cap. Long-term: move `analyzeReceipt`/`suggestMeal` calls into a Cloud Function that holds the key server-side.

---

### [SEC-04] Rate limiter fails open on Firestore error — quota bypass in quickAdd API

- **Evidence**: `functions/src/quickAdd/apiKeyValidation.ts:195–199` — the `checkRateLimit` catch block explicitly returns `{ allowed: true }` on any Firestore error: `// Fail open to not block legitimate requests on errors`.
- **Impact**: If the `apiUsage` Firestore document is unreachable (transient network error, quota exhaustion, cold-start contention), all rate limit checks for that window succeed unconditionally. An attacker who can trigger Firestore errors (e.g., via sustained parallel requests that exhaust Cloud Functions' Firestore connection pool, or during a known Firestore outage) can bypass rate limits entirely and submit unlimited habit toggles, expenses, or shopping items. In a multi-household SaaS context this becomes a billing amplification path: unlimited writes to the household's subcollections.
- **Effort**: S — change the fail-open to fail-closed (return `{ allowed: false }`) or return a 503 to the caller; add a circuit-breaker counter in memory for the invocation lifetime.
- **Risk**: LOW to MED — changing to fail-closed may frustrate legitimate users during Firestore incidents, but the current behavior is a silent security hole. A 503 response is the safer middle ground.
- **Confidence**: HIGH (read the code, confirmed the comment confirms intent).
- **Fix sketch**: Change `return { allowed: true }` to `return { allowed: false, retryAfterMs: 60000 }` in the catch block, and return a 503 to callers when the rate limit state is unknown. Log the error with sufficient detail to distinguish a Firestore issue from a logic bug.

---

### [SEC-05] CORS wildcard on Cloud Functions — all origins accepted with credentials path

- **Evidence**: `functions/src/quickAdd/index.ts:58–62` — `corsHeaders` sets `Access-Control-Allow-Origin: *` for all five quickAdd endpoints. All five functions also pass `{ cors: true }` to `onRequest()` (lines 68, 260, 487, 578, 951), which applies the Firebase Functions SDK's default CORS middleware (also wildcard).
- **Impact**: A wildcard `Access-Control-Allow-Origin` means any website can make cross-origin POST requests to these endpoints. This is intentional for iOS Shortcuts (which does not use a browser origin), but it means a malicious webpage can also call these endpoints using a stolen API key stored in the browser (e.g., from a leaked key in a public repo clone or a shared shortcut). The API key is the only authentication mechanism, and its format (`lb_{6alnum}_{32hex}`) is documented in the codebase. The risk is elevated because these endpoints write financial transaction data.
- **Effort**: S — restrict to known origins (the Firebase Hosting domain + `null` for non-browser callers) once the iOS Shortcuts workflow is confirmed not to send an `Origin` header.
- **Risk**: LOW — fixing requires verifying that iOS Shortcuts does not send an `Origin` header (it typically does not; it is not a browser). If it does, `null` must remain allowed.
- **Confidence**: MED — the concrete risk depends on whether API keys are ever exposed externally; the CORS policy itself is confirmed HIGH confidence.
- **Fix sketch**: Verify iOS Shortcuts does not send `Origin`. If confirmed, restrict `Access-Control-Allow-Origin` to `https://your-project.web.app` (the Hosting domain) in the explicit `corsHeaders` object, and also override the `cors: true` SDK option with an explicit allowlist. Keep `null` allowed only if needed for non-browser callers.

---

### [SEC-06] API call audit log (`logs/api_calls/requests`) has no Firestore security rules

- **Evidence**: `firestore.rules` — the only `logs/` rule is `match /logs/ai_usage/requests/{requestId}` (line 751). There is no rule for `logs/api_calls/requests/{requestId}`, which is the collection written by `logApiCall()` in `functions/src/quickAdd/apiKeyValidation.ts:272`. In Firestore, collections without a matching rule default to **deny** for client SDK access, but Cloud Functions use the Admin SDK which bypasses rules. The absence of a rule is not itself a bypass — it just means no rule-enforced read restriction exists if a rule-matching path were ever added. More critically, the audit log collection path is not covered by the catch-all `/{subcollection}/{document}` rule (which is scoped inside `households/{householdId}`), so the collection is effectively invisible to the rules auditor.
- **Impact**: If the collection path were ever read-enabled (e.g., by a future `match /logs/{rest=**}` rule added for monitoring), audit records containing `householdId`, `keyPrefix`, `endpoint`, and sanitized request bodies would be readable by any authenticated user who guesses the path. Currently the default-deny protects it, but the absence of an explicit rule is a documentation/defense-in-depth gap that will surprise the next auditor.
- **Effort**: S — add an explicit `match /logs/{logType}/requests/{requestId} { allow read: if isSuperAdmin(); allow write: if false; }` rule (writes go via Admin SDK only).
- **Risk**: LOW — current behavior is deny-by-default; the fix is purely additive.
- **Confidence**: HIGH (confirmed no matching rule in the 757-line file).
- **Fix sketch**: Add an explicit rule at the `logs` level: `match /logs/{logType}/{subcollection}/{docId} { allow read: if isSuperAdmin(); allow write: if false; }`. This makes the deny explicit and prevents future accidental reads if the rules are reorganized.

---

### [SEC-07] No Content-Security-Policy header on Firebase Hosting

- **Evidence**: `firebase.json:18–40` — security headers include `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`, `Referrer-Policy`, `Permissions-Policy`. There is no `Content-Security-Policy` header.
- **Impact**: Without a CSP, any XSS vulnerability (including one introduced via a future dependency or a compromised build artifact) can freely exfiltrate session tokens, make authenticated Firestore calls, or access financial data in the DOM. For a finance app that displays balance and transaction data, XSS without CSP is a high-severity combination. The app uses `react-hot-toast`, `framer-motion`, Google Fonts (loaded from `index.html`), and Firebase CDN scripts from the service worker — all of which need whitelisting, making a strict CSP non-trivial but achievable.
- **Effort**: M — drafting the initial CSP requires auditing all script/style/connect/font sources; tuning it to avoid breaking the PWA and the Firebase JS SDK's internal `fetch` calls adds iteration time.
- **Risk**: MED — an overly strict CSP will break the app (especially `connect-src` for Firestore/FCM WebSocket); requires careful testing.
- **Confidence**: HIGH (confirmed absence in `firebase.json`).
- **Fix sketch**: Start with a report-only CSP (`Content-Security-Policy-Report-Only`) to gather violations without breaking production. Minimum targets: `default-src 'self'`, explicit `connect-src` for `*.googleapis.com *.firebaseio.com`, `script-src 'self'` (no `unsafe-inline` — the Vite build uses hashed assets), `font-src fonts.gstatic.com`, `frame-ancestors 'none'` (redundant with X-Frame-Options but belt-and-suspenders). Add to `firebase.json` headers block.

---

### [SEC-08] `protobufjs` critical advisory in runtime dependency chain (`@google/genai`)

- **Evidence**: `pnpm audit` output — GHSA-xq3m-2v4x-88gg: Arbitrary code execution in `protobufjs <7.5.5`; path: `. > @google/genai@2.8.0 > protobufjs@7.5.4` (root workspace, reachable at runtime via the Gemini AI service). `@google/genai` is a production dependency used by `services/geminiService.ts`.
- **Impact**: `protobufjs` parses untrusted `.proto` descriptor content; the vulnerability allows arbitrary code execution if attacker-controlled Protobuf schema data reaches the parser. In this app's usage, the Gemini SDK uses protobufjs internally for its gRPC transport — the risk depends on whether attacker-controlled data flows through schema parsing (moderate, not zero). The advisory is rated critical by the ecosystem.
- **Effort**: S — update `@google/genai` to a version that depends on `protobufjs >=7.5.5`, or add a `pnpm overrides` entry for `protobufjs`.
- **Risk**: LOW for the fix — updating a transitive dependency via overrides is low-blast-radius.
- **Confidence**: HIGH (confirmed by `pnpm audit`; dependency path confirmed).
- **Fix sketch**: Add `"pnpm": { "overrides": { "protobufjs": ">=7.5.5" } }` to root `package.json`. Verify `@google/genai` still builds and receipt/meal suggestion features still work in test mode.

---

### [SEC-09] `basic-ftp` critical advisory in dev toolchain (`firebase-tools`) — low runtime risk

- **Evidence**: `pnpm audit` — GHSA-5rq4-664w-9x2c: Path traversal in `basic-ftp <5.2.0`; path: `. > firebase-tools@15.22.0 > proxy-agent@6.5.0 > ... > basic-ftp@5.1.0`.
- **Impact**: `firebase-tools` is a dev/deploy dependency (not imported into the client bundle or Cloud Functions runtime). The vulnerability is in the FTP client's `downloadToDir()` method — not a code path exercised by any Firebase Hosting or Functions deployment. Risk is effectively limited to developer machines and CI where `firebase-tools` runs. The path traversal would require a malicious FTP server, which is not part of this deployment pipeline.
- **Effort**: S — `firebase-tools` version bump (or `pnpm overrides` for `basic-ftp`), but the upstream dependency chain means this may need to wait for a `firebase-tools` release.
- **Risk**: LOW for the fix.
- **Confidence**: HIGH (confirmed path is dev tooling only).
- **Fix sketch**: Add a `pnpm overrides` for `basic-ftp` to `>=5.2.0` and verify `firebase deploy` still works in CI. Alternatively, track the `firebase-tools` release notes and upgrade when a fixed version ships.

---

### [SEC-10] Wildcard catch-all subcollection rule allows unvalidated writes to unknown future collections

- **Evidence**: `firestore.rules:690–712` — the catch-all `match /{subcollection}/{document}` inside `households/{householdId}` allows any authenticated household member to write to *any* subcollection not in the exclusion list. The exclusion list currently has 11 named subcollections, but any new subcollection added to the codebase without a corresponding Firestore rule will fall through to this catch-all with no schema validation.
- **Impact**: A developer adding a new feature collection (e.g., `budgetGoals`, `notes`) who forgets to add a specific rule gets a permissive write path with no input validation — full storage exhaustion potential and possible data corruption. This is an architectural defense-in-depth gap, not an active vulnerability in existing code.
- **Effort**: S — change the catch-all `allow write` to `allow write: if false` (deny by default, forcing explicit rules for every new collection) and add explicit read rules as needed. Or add a linting step that flags new collection names appearing in the client without a corresponding Firestore rule.
- **Risk**: LOW — the change will break any unknown collections that currently rely on the catch-all (there appear to be none in the current codebase, but should be verified with a grep for `.collection(` calls).
- **Confidence**: HIGH (rule text confirmed at lines 690–712).
- **Fix sketch**: Change `allow write: if isMemberOf(householdId) && subcollection != ...` to `allow write: if false` and keep the read rule (members can read unknown subcollections). Add a comment requiring an explicit rule for any new subcollection. Run `grep -rn '\.collection(' src/ --include="*.ts*"` to enumerate all referenced collections and verify each has a named rule.

---

### [SEC-11] `habitName` fuzzy match leaks habit existence across household members — not an IDOR but a minor info disclosure

- **Evidence**: `functions/src/quickAdd/index.ts:182–184` — when a habit is not found by name, the error response includes the searched name verbatim: `errorResponse(res, 404, \`Habit not found: ${habitId || habitName}\`, "NOT_FOUND")`. The calling API key is scoped to the household (tenant isolation is correct), so this is within-household-only; no cross-household leak.
- **Impact**: The 404 message echoes back user-supplied input. If `habitName` contains injection characters (e.g., `<script>`, path separators), they appear in the JSON response body. This is unlikely to be exploited in the current iOS Shortcut context (JSON, no browser rendering), but it is a pattern to avoid.
- **Effort**: S — replace the echoed name with a static message: `"Habit not found"` (omit the searched term from the error body).
- **Risk**: LOW (no HTML rendering of the response; fix is trivial).
- **Confidence**: HIGH.
- **Fix sketch**: Change line 182 to `errorResponse(res, 404, "Habit not found", "NOT_FOUND")`. Apply the same pattern to any other 404/400 responses that echo user input back.

---

## Summary table (ordered by leverage = impact ÷ effort × confidence)

| ID | Title | Severity | Confidence | Effort |
|----|-------|----------|------------|--------|
| SEC-07 | No Content-Security-Policy header | HIGH | HIGH | M |
| SEC-01 | VITE_ADMIN_UID client-side admin gate (tracked, not novel) | MED | HIGH | M |
| SEC-04 | Rate limiter fails open on Firestore error | MED | HIGH | S |
| SEC-08 | protobufjs critical advisory (runtime dep) | MED | HIGH | S |
| SEC-05 | CORS wildcard on Cloud Functions | MED | MED | S |
| SEC-10 | Catch-all Firestore rule allows unvalidated writes to new collections | MED | HIGH | S |
| SEC-06 | API call audit log has no Firestore security rule | LOW | HIGH | S |
| SEC-02 | Hardcoded super-admin UID in rules (already tracked) | MED | HIGH | S |
| SEC-03 | VITE_GEMINI_API_KEY in bundle (already tracked) | MED | HIGH | L |
| SEC-09 | basic-ftp critical advisory (dev toolchain only) | LOW | HIGH | S |
| SEC-11 | habitName echoed in 404 response | LOW | HIGH | S |
