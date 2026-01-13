# Curator's Journal

## 2025-02-14 - Major Version Holds
**Blocker:** recharts
**Reason:** Major version update (v2 -> v3). Project relies on v2.15.0+ for React 19 compatibility, but v3 likely introduces breaking API changes.
**Plan:** Manual review required. Stick to v2.x until stability is confirmed.

**Blocker:** tailwind-merge
**Reason:** Major version update (v2 -> v3).
**Plan:** Manual review required.

## 2025-02-14 - Initial Cleanup
**Cleanup:** dotenv
**Reason:** Redundant due to `tsx` native environment variable handling.
**Action:** Removed from devDependencies.
