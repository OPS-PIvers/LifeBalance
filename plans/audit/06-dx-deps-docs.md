# Audit: DX, Dependencies & Docs (§6, §7, §8)

**Audited:** 2026-06-21  
**Branch:** main (clean)  
**Audit scope:** Dependencies, DX/tooling, CI/CD, Docs  
**Playbook sections read:** §6, §7, §8, Finding format

---

## Findings

### [DEPS-01] Critical: protobufjs arbitrary-code-execution in production dependency path

- **Evidence:** `pnpm audit` — `@google/genai@2.8.0 > protobufjs@7.5.4` (GHSA-xq3m-2v4x-88gg). The `@google/genai` SDK is a runtime production dependency listed in `package.json:35`. `protobufjs@7.5.5` is the patched version.
- **Impact:** The vulnerable `protobufjs` is bundled into the shipped client-side JS (`vendor-ai` chunk per `vite.config.ts:84`). An attacker who can influence protobuf message parsing can achieve arbitrary code execution in the browser. This is a finance app with real account balances — the blast radius is high.
- **Effort:** S (hours) — bump `@google/genai` to a version that ships `protobufjs >=7.5.5`, or add a pnpm override `"protobufjs": ">=7.5.5"` in `package.json:79-85`.
- **Risk:** LOW — patch is semver-compatible; Gemini SDK usage (receipt scanning, meal suggestions) should be smoke-tested after bump.
- **Confidence:** HIGH (read the code and the audit output).
- **Fix sketch:** Add `"protobufjs": ">=7.5.5"` to `pnpm.overrides` in `package.json` (same pattern as existing `fast-xml-parser`, `qs` overrides already there). Alternatively upgrade `@google/genai` if a newer version bundles the patched dep.

---

### [DEPS-02] Critical (devDependency/tool path): basic-ftp path traversal in firebase-tools

- **Evidence:** `pnpm audit` — `. > firebase-tools@15.22.0 > proxy-agent@6.5.0 > pac-proxy-agent@7.2.0 > get-uri@6.0.5 > basic-ftp@5.1.0` (GHSA-5rq4-664w-9x2c). `firebase-tools` is a devDependency (`package.json:63`).
- **Impact:** Affects the local dev environment and the CI/CD deploy runner (deploy.yml uses `pnpm exec firebase deploy`). Path traversal risk is in the FTP download path — exploitable only if a malicious FTP URI is processed, which requires an adversarial proxy config. Risk is LOW in normal CI, but severity is "critical" per the advisory.
- **Effort:** S — add pnpm override `"basic-ftp": ">=5.2.0"` or wait for `firebase-tools` to bump its transitive chain.
- **Risk:** LOW (devDependency, exploit requires active proxy manipulation).
- **Confidence:** HIGH.
- **Fix sketch:** Add `"basic-ftp": ">=5.2.0"` to `pnpm.overrides`. Verify `pnpm audit` drops to 0 critical.

---

### [DEPS-03] High (multiple): protobuf.js code-injection and DoS (multiple CVEs)

- **Evidence:** `pnpm audit` — multiple HIGH advisories against `protobufjs@7.5.4` via `@google/genai` (GHSA-xq3m-2v4x-88gg root covers code execution; additional advisories include prototype pollution, code generation gadget, and process-wide DoS). Same package, same fix as DEPS-01.
- **Impact:** Client-side prototype pollution or DoS is possible if untrusted protobuf data can be deserialized. The Gemini SDK uses protobuf for streaming responses.
- **Effort:** S — same fix as DEPS-01.
- **Risk:** LOW.
- **Confidence:** HIGH.
- **Fix sketch:** Covered by DEPS-01 fix (protobufjs override).

---

### [DEPS-04] High (many): minimatch ReDoS in devDependency chain (eslint)

- **Evidence:** `pnpm audit` — 41 paths trace through `eslint@9.39.2 > minimatch@3.1.2` (advisories GHSA-3ppc-4f35-3m26, GHSA-7r86-cg39-jmmj, GHSA-23c5-xmqv-rm74). `minimatch` is a transitive devDependency only — it does not appear in the production bundle.
- **Impact:** ReDoS risk is confined to the lint-staged/CI lint process, not the deployed app. Exploit requires a crafted glob pattern input to eslint's config resolution — extremely low real-world risk.
- **Effort:** S — add `"minimatch": ">=3.1.3"` override, or wait for eslint to bump.
- **Risk:** VERY LOW (devDependency, attack requires CI input manipulation).
- **Confidence:** HIGH.
- **Fix sketch:** Add `"minimatch": ">=3.1.3"` to `pnpm.overrides`. (The pnpm overrides pattern is already used for `qs`, `glob`, etc.)

---

### [DEPS-05] package-lock.json / pnpm-lock.yaml dual-lockfile drift risk

- **Evidence:** CLAUDE.md notes "A stray `package-lock.json` exists alongside `pnpm-lock.yaml`; do not run `npm install`." The file exists at `C:\Users\paul.ivers\Desktop\Code\LifeBalance\package-lock.json`. CI uses `pnpm install --frozen-lockfile` (ci.yml:19), so CI is safe. Risk is local developer accidentally running `npm install`, which overwrites nothing in `pnpm-lock.yaml` but can silently install a different dep graph in `node_modules`, making local tests pass on different versions than CI.
- **Impact:** A developer could unknowingly test against different transitive versions than CI resolves, masking bugs. The stray file also signals to tools (Renovate, Dependabot) that this is an npm repo.
- **Effort:** S — delete `package-lock.json`, add it to `.gitignore`.
- **Risk:** LOW (no production impact; deleting the file cannot break CI).
- **Confidence:** HIGH.
- **Fix sketch:** `git rm package-lock.json`, add `package-lock.json` to `.gitignore`. Add an `engines` npm/pnpm field warning or a root `.npmrc` with `engine-strict=true`.

---

### [DEPS-06] TypeScript version skew between root (^6.0.3) and functions/ (^5.9.3)

- **Evidence:** Root `package.json:72` — `"typescript": "^6.0.3"`; `functions/package.json:29` — `"typescript": "^5.9.3"`. These are major-version-apart; TS 6 has breaking changes in strict type-checking behaviour relative to TS 5.
- **Impact:** A type signature valid in the functions/ TS 5 compile may be rejected or silently widened in the root TS 6 compile (and vice versa). Shared logic copied between the workspaces (streak logic, date helpers) could pass functions lint but fail root lint or have different inferred types.
- **Effort:** S-M — upgrade `functions/` to `typescript@^6.0.0` and fix any new errors (functions/ is small).
- **Risk:** MED — TS 6 strict changes may surface real type gaps in functions/ code.
- **Confidence:** HIGH.
- **Fix sketch:** Bump `functions/package.json` to `"typescript": "^6.0.0"`. Run `pnpm --filter functions run lint` and fix newly-surfaced type errors.

---

### [DX-01] No E2E test framework — critical sign-up and finance flows are completely uncovered

- **Evidence:** No `playwright.config.*` found anywhere in the repo. No `e2e/` or `cypress/` directory. CI (`ci.yml`) runs only unit tests via Vitest. The coverage gate (`vite.config.ts:39-46`) explicitly only covers `utils/**`, leaving all React components, contexts, pages, and services outside any coverage requirement. The authentication, household-setup, transaction-entry, and safe-to-spend display flows have zero automated integration test coverage.
- **Impact:** Any regression in sign-up, Google Auth callback, household join, or budget entry can ship undetected. For a finance app approaching public launch with real money data, this is the highest-leverage gap. Manual testing before each deploy is the only safety net today.
- **Effort:** L (multi-day) — install Playwright, write skeleton tests for 3-4 critical paths (login→dashboard, add transaction, check safe-to-spend). Test mode (`VITE_ENABLE_TEST_MODE=true`) already provides a mock backend, which makes E2E tests significantly cheaper to write (no Firebase emulator needed for most paths).
- **Risk:** LOW (adding tests cannot break production).
- **Confidence:** HIGH.
- **Fix sketch:** `pnpm add -D @playwright/test`, add `playwright.config.ts` pointing at `http://localhost:3000`, write tests using the existing `?test=true` test-mode URL. Add a `pnpm test:e2e` script and a CI job gated on the existing build step.

---

### [DX-02] Firestore security rules have zero automated unit tests — rules deploy untested

- **Evidence:** No `@firebase/rules-unit-testing` package anywhere in `package.json`. No `*.rules.test.*` file found. `firestore.rules` is 757 lines with 15+ subcollections and complex `isValidAiUsageUpdate()` / `isSuperAdmin()` / `isValidMemberUpdate` logic. `firebase.json:79` sets `"rules": "firestore.rules"`, and `deploy.yml:71` deploys all resources including rules together (`firebase deploy --project lifebalance-26080` deploys hosting+functions+rules atomically). CI (`ci.yml`) does not run rules tests.
- **Impact:** Rules bugs ship to production without any automated verification. The `isSuperAdmin()` function has a known open TODO (hardcoded UID fallback, tracked in `docs/DEPLOY_CHECKLIST.md`). A rules regression could silently allow unauthorized reads of household financial data, or silently deny legitimate writes, breaking the app for all users.
- **Effort:** M (a day-ish) — set up `@firebase/rules-unit-testing`, write tests for the happy path and key denial paths per subcollection. Wire into CI.
- **Risk:** LOW (tests are additive; the rules themselves are not changed).
- **Confidence:** HIGH.
- **Fix sketch:** `pnpm add -D @firebase/rules-unit-testing`, create `firestore.rules.test.ts` exercising at minimum: household member read/write isolation, `isValidAiUsageUpdate` increment and bypass, apiKeys admin-only guard. Add `pnpm test:rules` script and a CI step.

---

### [DX-03] Functions tests not gated in CI or deploy pipeline — functions ship on build success alone

- **Evidence:** `ci.yml:46-47` — "Build Functions" step runs `pnpm --filter functions run build` (TypeScript compile only). There is no `pnpm --filter functions run test` step. `deploy.yml:35-37` — runs root `pnpm test` (Vitest, root only); no functions test step before deploy. The functions workspace has two test files (`functions/src/quickAdd/habitProcessor.test.ts`, `functions/src/quickAdd/index.test.ts`) that are currently run by the ROOT Vitest (noted in `index.test.ts:4`: "picked up by the ROOT Vitest runner") — but only because Vitest has no `include` restriction. This is fragile and not explicit.
- **Impact:** If the functions test files ever move or the root vite.config.ts adds an `include` filter, functions tests silently stop running. More importantly, the functions workspace has its own `pnpm test` slot that is never invoked — adding real functions-only tests there would not be caught by CI or deploy.
- **Effort:** S (hours) — add an explicit `pnpm --filter functions run test` step to both `ci.yml` and `deploy.yml`.
- **Risk:** LOW (adding CI steps cannot break the app).
- **Confidence:** HIGH.
- **Fix sketch:** Add `"test": "vitest run"` to `functions/package.json` scripts (functions test files are already written for Vitest). Add `- run: pnpm --filter functions run test` after "Build Functions" in `ci.yml` and before the deploy step in `deploy.yml`.

---

### [DX-04] Deployment is a single-blast-radius atomic Firebase deploy with no staging channel

- **Evidence:** `deploy.yml:71` — `pnpm exec firebase deploy --project lifebalance-26080`. This deploys hosting, Firestore rules, and functions atomically to the single production project in one shot on every push to `main`. There is no Firebase Hosting preview channel configured, no separate `staging` project, and no rollback step. `firebase.json` has no `channels` configuration.
- **Impact:** A broken deploy (bad rules, broken function, bad bundle) hits all users immediately with no quick recovery path beyond re-running the full deploy pipeline. For a finance app, a bad Firestore rules deploy could make account data unreadable for all users until a fix lands.
- **Effort:** M — add a Firebase Hosting preview channel for PRs (`firebase hosting:channel:deploy`), and add a separate `--only hosting` step before `--only functions` to limit blast radius.
- **Risk:** LOW (adding channels is additive; existing prod flow unchanged).
- **Confidence:** HIGH.
- **Fix sketch:** Add `firebase-action/action@v0.7` (or equivalent) to deploy.yml for preview-channel PR deploys. Split the production deploy into ordered steps: `firebase deploy --only firestore:rules`, then `firebase deploy --only functions`, then `firebase deploy --only hosting` — so a rules failure does not also bounce functions, and failure is attributable.

---

### [DX-05] Coverage gate is utils/-only; contexts and services are entirely ungated

- **Evidence:** `vite.config.ts:38-46` — thresholds block is `'utils/**/*.{ts,tsx}'` only. `contexts/FirebaseHouseholdContext.tsx` (the heart of all data logic) and `services/geminiService.ts` (AI calls with quota logic) are excluded from any floor. `ci.yml:25-31` comment confirms: "Enforces the coverage thresholds for utils/** configured in vite.config.ts". Context tests exist (`contexts/FirebaseHouseholdContext.test.tsx`, `contexts/MockHouseholdContext.test.tsx`) but their coverage is not gated.
- **Impact:** Regressions in the context (safe-to-spend calculation wiring, Firestore listener teardown) or the Gemini quota check can ship without breaking CI. For a finance app, the context is where money state is managed.
- **Effort:** S-M — measure current context/services coverage, set a floor just under the current numbers, add to `vite.config.ts` thresholds.
- **Risk:** LOW if the floor is set at current coverage (not aspirational).
- **Confidence:** HIGH.
- **Fix sketch:** Run `pnpm test:coverage`, note actual line/branch % for `contexts/**` and `services/**`, add two new threshold blocks at -2% of those values to `vite.config.ts` coverage config.

---

### [DX-06] No CSP header deployed — missing from firebase.json hosting headers

- **Evidence:** `firebase.json:15-43` — security headers block includes `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`, `Referrer-Policy`, `Permissions-Policy`. There is no `Content-Security-Policy` header. The app loads Google Fonts from `https://fonts.googleapis.com` (referenced in `index.html`), uses Firebase Hosting (same-origin assets), and makes Gemini API calls from the browser.
- **Impact:** Without a CSP, XSS attacks have no browser-enforced containment. This is especially notable for a finance app that displays balance data and allows AI-parsed input (receipt OCR results rendered to DOM).
- **Effort:** M — defining and iterating on a working CSP that allows Firebase, Google Fonts, and Gemini without breakage takes a few cycles.
- **Risk:** MED — a too-restrictive CSP breaks features (Firebase Auth popup, Google Fonts); requires testing before shipping.
- **Confidence:** HIGH.
- **Fix sketch:** Start with `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com;` in `firebase.json` headers, test with browser console, tighten iteratively.

---

### [DX-07] VITE_ADMIN_UID is a client-side env var exposing the super-admin UID in the bundle

- **Evidence:** `deploy.yml:61` — `VITE_ADMIN_UID: ${{ secrets.VITE_ADMIN_UID }}`. Any `VITE_*` variable is inlined into the shipped JS bundle by Vite. The same UID (`nmYdn3QPsNQEvniJEXW9M3lmV5e2`) is hardcoded in `firestore.rules:31` as the `isSuperAdmin()` fallback (tracked in `docs/DEPLOY_CHECKLIST.md`). Exposing the UID in both the bundle and the rules file together makes it trivially enumerable.
- **Impact:** The super-admin UID is now public information (bundle + rules). This does not directly grant access (Firestore rules still require a valid ID token), but it aids targeted attacks and is unnecessary once the `admin` custom claim is provisioned (the tracked DEPLOY_CHECKLIST.md step 1).
- **Effort:** S — after provisioning the custom claim and removing the UID fallback from rules (existing DEPLOY_CHECKLIST.md item 1), remove `VITE_ADMIN_UID` from deploy.yml and any client code that reads it.
- **Risk:** LOW (the UID alone grants no privilege; risk is informational exposure).
- **Confidence:** HIGH (read deploy.yml and rules file).
- **Fix sketch:** Complete DEPLOY_CHECKLIST.md §1 (provision `admin` custom claim, remove UID fallback from rules). Then grep for `VITE_ADMIN_UID` usage in client code and remove. Remove the secret from GitHub and the `deploy.yml` env block.

---

### [DOCS-01] DEPLOY_CHECKLIST.md §1 (super-admin UID fallback) has been open since initial audit — no completion timeline

- **Evidence:** `docs/DEPLOY_CHECKLIST.md:14-74` — item 1 is marked `🔴` (critical) and has a detailed gated-removal procedure. The procedure is correct and actionable. No completion date or owner is recorded. The hardcoded UID (`nmYdn3QPsNQEvniJEXW9M3lmV5e2`) remains in `firestore.rules:31` today. This is a docs-as-tracker item with a concrete ops step that must precede a code change.
- **Impact:** Until the custom claim is provisioned, the rules hardcode a public UID as a super-admin backdoor. Blocking the monetization launch because it's a known open security item.
- **Effort:** S (the ops step is < 1 hour; the code change is a 2-line rules edit).
- **Risk:** MED — getting the order wrong (delete UID before claim is confirmed) causes admin lockout; the checklist doc correctly sequences the steps.
- **Confidence:** HIGH.
- **Fix sketch:** Assign an owner and "must-complete before launch" deadline. The procedure in DEPLOY_CHECKLIST.md is correct; just execute it.

---

### [DOCS-02] .env.local.example is complete — no gap (not a finding)

- **Evidence:** `.env.local.example` documents all 9 env vars used in CI (`ci.yml:35-45`) and deploy (`deploy.yml:52-61`) including `VITE_ADMIN_UID` and `VITE_ENABLE_TEST_MODE`. All CLAUDE.md-listed vars are present.
- **Verdict:** Not a finding; `.env.local.example` is accurate and current.

---

## Summary table (ordered by leverage)

| ID | Title | Sev | Effort | Confidence |
|----|-------|-----|--------|------------|
| DX-01 | No E2E test framework | HIGH | L | HIGH |
| DX-02 | Firestore rules have zero automated tests | HIGH | M | HIGH |
| DEPS-01 | Critical: protobufjs ACE in production bundle | CRITICAL | S | HIGH |
| DEPS-02 | Critical: basic-ftp path traversal (devDep) | CRITICAL | S | HIGH |
| DX-03 | Functions tests not gated in CI/deploy | MED | S | HIGH |
| DX-04 | Single-blast-radius deploy, no staging channel | MED | M | HIGH |
| DX-05 | Coverage gate excludes contexts and services | MED | S | HIGH |
| DX-06 | No CSP header in firebase.json | MED | M | HIGH |
| DX-07 | VITE_ADMIN_UID exposes super-admin UID in bundle | MED | S | HIGH |
| DOCS-01 | DEPLOY_CHECKLIST §1 open, no owner/deadline | MED | S | HIGH |
| DEPS-03 | High: protobuf.js additional CVEs (same fix as DEPS-01) | HIGH | S | HIGH |
| DEPS-04 | High: minimatch ReDoS in devDep chain | LOW | S | HIGH |
| DEPS-05 | package-lock.json / pnpm-lock.yaml drift risk | LOW | S | HIGH |
| DEPS-06 | TypeScript major version skew root vs functions/ | LOW | S-M | HIGH |
