# Sentinel's Journal

## 2025-02-23 - Initial Security Baseline
**Vulnerability:** Missing standard security headers (HSTS, X-Frame-Options, X-Content-Type-Options) in `firebase.json`.
**Learning:** Default Firebase Hosting configuration provides caching headers but lacks active security hardening headers, leaving the app potentially vulnerable to clickjacking and MIME sniffing.
**Prevention:** Always explicitly configure `headers` in `firebase.json` for `index.html` to enforce browser-side security protections.
