-- Migration 124: retire OnDemandMonitoringHealth.
--
-- Migration 083 created a singleton row that the hourly reconciliation wrote
-- after each complete authoritative read. The same run also wrote the
-- spare_on_demand_reconciliation row in KpiFeedHealth, so On-Demand currency
-- was recorded twice, by two non-atomic statements, and read through both: the
-- console and the intervention evaluator read this table, KPI trust and
-- Suggested Alert preparation read the ledger. As of 1.5.228 the monitoring
-- state is a projection of the KPI trust on_demand stream
-- (lib/onDemandMonitoringStatus.ts) and nothing reads or writes this table.
--
-- Apply AFTER the 1.5.228 REST API is deployed. The code before it writes this
-- table on every reconciliation and would fail its run without it; the code
-- after it never touches it, so dropping it then changes nothing.
--
-- The row holds no history (it was overwritten each hour) and nothing the
-- ledger does not also hold, except latest_source_update_at, which the console
-- now reads from MonitoredOnDemandWaits.
--
-- Re-runnable.

IF OBJECT_ID(N'dbo.OnDemandMonitoringHealth', N'U') IS NOT NULL
BEGIN
  DECLARE @last NVARCHAR(40) = (
    SELECT CONVERT(NVARCHAR(40), last_authoritative_reconciliation_at, 126) FROM dbo.OnDemandMonitoringHealth WHERE id = 1
  );
  PRINT CONCAT('Migration 124: dropping OnDemandMonitoringHealth (last reconciliation recorded there: ', COALESCE(@last, 'none'), ').');
  DROP TABLE dbo.OnDemandMonitoringHealth;
END;
GO

PRINT 'Migration 124 applied: OnDemandMonitoringHealth retired; On-Demand currency is the KpiFeedHealth spare_on_demand_reconciliation row.';
