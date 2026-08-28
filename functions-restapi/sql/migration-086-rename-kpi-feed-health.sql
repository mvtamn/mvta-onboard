-- The feed-health ledger backs every KPI trust stream, not only missed trips.
-- Migration 082 made the missed-trip producer keys the canonical KPI keys; this
-- renames the table to match. Application code resolves the table name at call
-- time and accepts either, so this migration and the deployment that follows it
-- may land in either order.
IF OBJECT_ID(N'dbo.KpiFeedHealth', N'U') IS NULL
   AND OBJECT_ID(N'dbo.MissedTripFeedHealth', N'U') IS NOT NULL
  EXEC sp_rename N'dbo.MissedTripFeedHealth', N'KpiFeedHealth';
GO

-- A database that never ran migration 027 has no ledger to rename.
IF OBJECT_ID(N'dbo.KpiFeedHealth', N'U') IS NULL
  CREATE TABLE dbo.KpiFeedHealth (
    feed_name            NVARCHAR(50) NOT NULL PRIMARY KEY,
    last_success_at      DATETIME2    NULL,
    last_entity_count    INT          NULL,
    source_timestamp_at  DATETIME2    NULL,
    coverage_start_at    DATETIME2    NULL,
    coverage_end_at      DATETIME2    NULL,
    last_failure_at      DATETIME2    NULL,
    last_failure_reason  NVARCHAR(1000) NULL,
    updated_at           DATETIME2    NOT NULL DEFAULT SYSUTCDATETIME()
  );
GO

PRINT 'Migration 086 verified: the shared KPI feed-health ledger is named KpiFeedHealth.';
