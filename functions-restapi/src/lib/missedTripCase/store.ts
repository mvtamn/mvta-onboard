// SQL for the Missed-trip case module: load the cases a pass observed, and
// write what decide.ts returned.
import { sql } from "../db";
import type { CaseState, RunDecision } from "./decide";

const CASE_COLUMNS = `
  m.trip_id, m.service_date, m.route_id, m.scheduled_departure_at, m.grace_deadline_at, m.status,
  m.validation_status, m.data_quality_status, m.detection_type, m.detector_version,
  ISNULL(m.source_system, N'gtfs') AS source_system, m.source_record_id, m.undecided_reason,
  m.detected_late_arrival_at, m.first_seen_watching_at, m.evidence_json, m.expected_window_end_at`;

export function caseKey(tripId: string, serviceDate: string): string {
  return `${tripId}|${serviceDate}`;
}

// Every stored case among `keys`, in one read.
export async function loadCases(pool: sql.ConnectionPool, keys: { tripId: string; serviceDate: string }[]): Promise<Map<string, CaseState>> {
  const found = new Map<string, CaseState>();
  if (keys.length === 0) return found;
  const unique = [...new Map(keys.map((k) => [caseKey(k.tripId, k.serviceDate), k])).values()];
  const result = await pool.request()
    .input("keys", sql.NVarChar(sql.MAX), JSON.stringify(unique.map((k) => ({ t: k.tripId, d: k.serviceDate }))))
    .query<CaseState>(`
      SELECT ${CASE_COLUMNS}
      FROM OPENJSON(@keys) WITH (t NVARCHAR(100) '$.t', d NVARCHAR(20) '$.d') k
      JOIN MonitoredMissedTrips m ON m.trip_id = k.t AND m.service_date = k.d`);
  for (const row of result.recordset) found.set(caseKey(row.trip_id, row.service_date), row);
  return found;
}

export async function loadCase(db: sql.ConnectionPool | sql.Transaction, tripId: string, serviceDate: string, lock: boolean): Promise<CaseState | null> {
  const request = db instanceof sql.Transaction ? new sql.Request(db) : new sql.Request(db);
  const result = await request
    .input("trip_id", sql.NVarChar(100), tripId)
    .input("service_date", sql.NVarChar(20), serviceDate)
    .query<CaseState>(`
      SELECT ${CASE_COLUMNS}
      FROM MonitoredMissedTrips m ${lock ? "WITH (UPDLOCK, HOLDLOCK)" : ""}
      WHERE m.trip_id = @trip_id AND m.service_date = @service_date`);
  return result.recordset[0] ?? null;
}

const TYPES: Record<string, () => sql.ISqlType> = {
  route_id: () => sql.NVarChar(50),
  scheduled_departure_at: () => sql.DateTime2(),
  grace_deadline_at: () => sql.DateTime2(),
  status: () => sql.NVarChar(20),
  data_quality_status: () => sql.NVarChar(30),
  detection_type: () => sql.NVarChar(30),
  detector_version: () => sql.NVarChar(30),
  undecided_reason: () => sql.NVarChar(60),
  detected_late_arrival_at: () => sql.DateTime2(),
  evidence_json: () => sql.NVarChar(sql.MAX),
};

// Writes one decision. Returns false when the row was not in the state the
// decision was made from (another writer got there first); the next pass
// decides again from what is stored then.
export async function writeDecision(pool: sql.ConnectionPool, decision: RunDecision): Promise<boolean> {
  if (decision.kind === "insert") {
    const row = decision.row;
    const result = await pool.request()
      .input("trip_id", sql.NVarChar(100), row.trip_id)
      .input("service_date", sql.NVarChar(20), row.service_date)
      .input("route_id", sql.NVarChar(50), row.route_id)
      .input("scheduled_departure_at", sql.DateTime2, row.scheduled_departure_at)
      .input("grace_deadline_at", sql.DateTime2, row.grace_deadline_at)
      .input("status", sql.NVarChar(20), row.status)
      .input("detection_type", sql.NVarChar(30), row.detection_type)
      .input("detector_version", sql.NVarChar(30), row.detector_version)
      .input("data_quality_status", sql.NVarChar(30), row.data_quality_status)
      .input("source_system", sql.NVarChar(20), row.source_system)
      .input("source_record_id", sql.NVarChar(100), row.source_record_id)
      .input("undecided_reason", sql.NVarChar(60), row.undecided_reason)
      .input("detected_late_arrival_at", sql.DateTime2, row.detected_late_arrival_at)
      .input("evidence_json", sql.NVarChar(sql.MAX), row.evidence_json)
      .input("expected_window_end_at", sql.DateTime2, row.expected_window_end_at)
      .query(`
        INSERT INTO MonitoredMissedTrips (
          trip_id, service_date, route_id, scheduled_departure_at, grace_deadline_at, status, detection_type,
          detector_version, data_quality_status, source_system, source_record_id, undecided_reason,
          detected_late_arrival_at, evidence_json, expected_window_end_at
        )
        SELECT @trip_id, @service_date, @route_id, @scheduled_departure_at, @grace_deadline_at, @status, @detection_type,
               @detector_version, @data_quality_status, @source_system, @source_record_id, @undecided_reason,
               @detected_late_arrival_at, @evidence_json, @expected_window_end_at
        WHERE NOT EXISTS (SELECT 1 FROM MonitoredMissedTrips WHERE trip_id = @trip_id AND service_date = @service_date)`);
    return (result.rowsAffected[0] ?? 0) > 0;
  }

  const request = pool.request()
    .input("trip_id", sql.NVarChar(100), decision.key.trip_id)
    .input("service_date", sql.NVarChar(20), decision.key.service_date)
    .input("expect_status", sql.NVarChar(20), decision.expect.status)
    .input("expect_validation", sql.NVarChar(20), decision.expect.validation_status);
  const sets = ["last_checked_at = SYSUTCDATETIME()"];
  for (const [column, value] of Object.entries(decision.set)) {
    const type = TYPES[column];
    if (!type) throw new TypeError(`Missed-trip case column ${column} is not writable`);
    sets.push(`${column} = @${column}`);
    request.input(column, type(), value);
  }
  const result = await request.query(`
    UPDATE MonitoredMissedTrips SET ${sets.join(", ")}
    WHERE trip_id = @trip_id AND service_date = @service_date
      AND status = @expect_status AND validation_status = @expect_validation`);
  return (result.rowsAffected[0] ?? 0) > 0;
}
