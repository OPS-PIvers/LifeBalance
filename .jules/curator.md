# Curator Journal

## 2025-02-27 - Recharts Version Lock
**Blocker:** recharts
**Reason:** Recharts must be strictly kept within the v2.x range (avoiding v3) to ensure React 19 compatibility.
**Plan:** Monitor Recharts v3 releases for React 19 support and migration guides. Stay on v2.15.0+ but <3.0.0.

## 2025-02-27 - Tailwind Merge v3 Scope Limitation
**Blocker:** tailwind-merge
**Reason:** Updating to v3 requires updating the importmap in `index.html` (CDN link), which is outside Curator's file modification scope.
**Plan:** Request valid scope expansion or coordinate update with another agent.
