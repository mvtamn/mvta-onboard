import type { ConnectionPool } from "mssql";
import { sql } from "./db";

export type EventHealthStatus = "healthy" | "degraded" | "failed" | "unknown";

export async function recordEventHealth(
  pool: ConnectionPool,
  component: string,
  status: EventHealthStatus,
  detail?: string | null,
  error?: unknown,
): Promise<void> {
  const request = pool.request();
  request.input("component", sql.NVarChar, component);
  request.input("status", sql.NVarChar, status);
  request.input("detail", sql.NVarChar, detail ?? null);
  request.input("error", sql.NVarChar, error == null ? null : error instanceof Error ? error.message : String(error));
  await request.query(`
    IF OBJECT_ID('dbo.EventModuleHealth', 'U') IS NOT NULL
      MERGE EventModuleHealth WITH (HOLDLOCK) AS target
      USING (SELECT @component component) AS source ON target.component=source.component
      WHEN MATCHED THEN UPDATE SET status=@status,last_attempt_at=SYSUTCDATETIME(),
        last_success_at=CASE WHEN @status='healthy' THEN SYSUTCDATETIME() ELSE last_success_at END,
        last_error=@error,detail=@detail,updated_at=SYSUTCDATETIME()
      WHEN NOT MATCHED THEN INSERT(component,status,last_attempt_at,last_success_at,last_error,detail)
        VALUES(@component,@status,SYSUTCDATETIME(),CASE WHEN @status='healthy' THEN SYSUTCDATETIME() END,@error,@detail);
  `);
}

export async function recordTelemetryDiagnostic(
  pool: ConnectionPool,
  component: string,
  reason: string,
  detail: string,
  vehicleId?: number | null,
  route?: number | null,
  reportTimestamp?: Date | null,
): Promise<void> {
  const request = pool.request();
  request.input("component", sql.NVarChar, component); request.input("reason", sql.NVarChar, reason);
  request.input("detail", sql.NVarChar, detail); request.input("vehicle", sql.Int, vehicleId ?? null);
  request.input("route", sql.Int, route ?? null); request.input("reported", sql.DateTime2, reportTimestamp ?? null);
  await request.query(`
    IF OBJECT_ID('dbo.EventTelemetryDiagnostics', 'U') IS NOT NULL
      INSERT INTO EventTelemetryDiagnostics(component,reason,detail,vehicle_id,route,report_timestamp)
      VALUES(@component,@reason,@detail,@vehicle,@route,@reported);
  `);
}
