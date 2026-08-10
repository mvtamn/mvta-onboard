import { app, type InvocationContext, type Timer } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { recordEventHealth } from "../lib/eventHealth";

app.timer("eventTelemetryMaintenance", {
  schedule: "0 0 * * * *",
  handler: async (_timer: Timer, context: InvocationContext) => {
    const pool = await getPool();
    try {
      await pool.request().query(`
        IF OBJECT_ID('dbo.EventTelemetryMaintenance', 'U') IS NOT NULL
          UPDATE EventTelemetryMaintenance SET last_started_at=SYSUTCDATETIME(),last_error=NULL,updated_at=SYSUTCDATETIME() WHERE id=1;
      `);
      const result = await pool.request().query<{ positions_deleted: number; diagnostics_deleted: number }>(`
        DECLARE @positions INT=0, @diagnostics INT=0;
        IF OBJECT_ID('dbo.EventVehiclePositionHistory', 'U') IS NOT NULL
        BEGIN
          DELETE FROM EventVehiclePositionHistory WHERE report_timestamp < DATEADD(DAY,-90,SYSUTCDATETIME());
          SET @positions=@@ROWCOUNT;
        END;
        IF OBJECT_ID('dbo.EventTelemetryDiagnostics', 'U') IS NOT NULL
        BEGIN
          DELETE FROM EventTelemetryDiagnostics WHERE recorded_at < DATEADD(DAY,-90,SYSUTCDATETIME());
          SET @diagnostics=@@ROWCOUNT;
        END;
        SELECT @positions positions_deleted,@diagnostics diagnostics_deleted;
      `);
      const deleted = result.recordset[0] ?? { positions_deleted: 0, diagnostics_deleted: 0 };
      await pool.request().input("positions", sql.Int, deleted.positions_deleted).input("diagnostics", sql.Int, deleted.diagnostics_deleted).query(`
        IF OBJECT_ID('dbo.EventTelemetryMaintenance', 'U') IS NOT NULL
          UPDATE EventTelemetryMaintenance SET last_success_at=SYSUTCDATETIME(),last_positions_deleted=@positions,last_diagnostics_deleted=@diagnostics,last_error=NULL,updated_at=SYSUTCDATETIME() WHERE id=1;
      `);
      await recordEventHealth(pool, "retention_cleanup", "healthy", `Deleted ${deleted.positions_deleted} positions and ${deleted.diagnostics_deleted} diagnostics.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Retention cleanup failed";
      context.error(message);
      await pool.request().input("error", sql.NVarChar, message).query(`
        IF OBJECT_ID('dbo.EventTelemetryMaintenance', 'U') IS NOT NULL
          UPDATE EventTelemetryMaintenance SET last_error=@error,updated_at=SYSUTCDATETIME() WHERE id=1;
      `);
      await recordEventHealth(pool, "retention_cleanup", "failed", null, message);
    }
  },
});
