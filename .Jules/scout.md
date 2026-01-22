# Scout's Journal

## 2025-05-15 - Testing Firestore Batch Migrations
**Gap:** Migration logic (`migrateBucketsToPeriods`) involving batch updates was completely untested (0% coverage).
**Fix:** Mocked `writeBatch` to return a spy object and used a sentinel string for `deleteField()` to verify payload structure without complex SDK mocks.
