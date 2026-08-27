import { sql } from "./db";

interface Candidate {
  trip_id: string;
  zone_id: string;
  current_wait_minutes: number;
  predicted_wait_minutes: number | null;
  service_standard_minutes: number;
}

interface InterventionRow {
  status: "open" | "resolved";
  projected_breach_count: number;
  suggested_alert_id: string | null;
}

export function onDemandInterventionDecision(
  priorProjectedBreachCount: number,
  currentWaitMinutes: number,
  predictedWaitMinutes: number | null,
  serviceStandardMinutes: number,
): { projectedBreachCount: number; needsIntervention: boolean } {
  const observedBreach = currentWaitMinutes > serviceStandardMinutes;
  const projectedBreach = (predictedWaitMinutes ?? 0) > serviceStandardMinutes;
  const projectedBreachCount = projectedBreach ? priorProjectedBreachCount + 1 : 0;
  return {
    projectedBreachCount,
    needsIntervention: observedBreach || projectedBreachCount >= 2,
  };
}

function draftText(candidate: Candidate): string {
  const predicted = candidate.predicted_wait_minutes ?? candidate.current_wait_minutes;
  return `MVTA Connect customers in Zone ${candidate.zone_id}: Pickup for this trip is predicted ` +
    `after approximately ${predicted} minutes, above the ${candidate.service_standard_minutes}-minute ` +
    "service standard. Please check for updated pickup information.";
}

async function ensureSuggestedAlert(pool: sql.ConnectionPool, candidate: Candidate): Promise<string> {
  const externalId = `wait:${candidate.trip_id}`.slice(0, 100);
  const existing = pool.request();
  existing.input("source", sql.NVarChar, "zona");
  existing.input("external_id", sql.NVarChar, externalId);
  const prior = await existing.query<{ alert_id: string }>(`
    SELECT alert_id FROM dbo.SuggestedAlerts WHERE source = @source AND external_id = @external_id;
  `);
  if (prior.recordset[0]) return prior.recordset[0].alert_id;

  const insert = pool.request();
  insert.input("source", sql.NVarChar, "zona");
  insert.input("external_id", sql.NVarChar, externalId);
  insert.input("draft_text", sql.NVarChar, draftText(candidate));
  insert.input("category", sql.NVarChar, "demand_response_delay");
  insert.input("severity", sql.NVarChar,
    (candidate.predicted_wait_minutes ?? candidate.current_wait_minutes) >= candidate.service_standard_minutes + 15 ? "major" : "minor");
  insert.input("zones_affected", sql.NVarChar, JSON.stringify([candidate.zone_id]));
  insert.input("detail", sql.NVarChar, JSON.stringify({
    detection_type: "on_demand_wait_risk",
    trip_id: candidate.trip_id,
    zone_id: candidate.zone_id,
    current_wait_minutes: candidate.current_wait_minutes,
    predicted_wait_minutes: candidate.predicted_wait_minutes,
    service_standard_minutes: candidate.service_standard_minutes,
    prepared_from: "authoritative_on_demand_reconciliation",
  }));
  try {
    const created = await insert.query<{ alert_id: string }>(`
      INSERT INTO dbo.SuggestedAlerts (source, external_id, draft_text, category, severity, zones_affected, detail)
      OUTPUT INSERTED.alert_id
      VALUES (@source, @external_id, @draft_text, @category, @severity, @zones_affected, @detail);
    `);
    return created.recordset[0].alert_id;
  } catch {
    // A concurrent reconciliation may have inserted the same idempotency key.
    const retry = pool.request();
    retry.input("source", sql.NVarChar, "zona");
    retry.input("external_id", sql.NVarChar, externalId);
    const createdElsewhere = await retry.query<{ alert_id: string }>(`
      SELECT alert_id FROM dbo.SuggestedAlerts WHERE source = @source AND external_id = @external_id;
    `);
    const alertId = createdElsewhere.recordset[0]?.alert_id;
    if (!alertId) throw new Error("Could not create or read the on-demand Suggested Alert");
    return alertId;
  }
}

export async function reconcileOnDemandInterventions(
  pool: sql.ConnectionPool,
  reconciledAt: Date,
): Promise<void> {
  const candidates = await pool.request().query<Candidate>(`
    SELECT m.trip_id, m.zone_id,
      CASE WHEN m.wait_started_at < SYSUTCDATETIME() THEN DATEDIFF(MINUTE, m.wait_started_at, SYSUTCDATETIME()) ELSE 0 END AS current_wait_minutes,
      CASE WHEN m.predicted_pickup_at IS NULL THEN NULL WHEN m.predicted_pickup_at > m.wait_started_at THEN DATEDIFF(MINUTE, m.wait_started_at, m.predicted_pickup_at) ELSE 0 END AS predicted_wait_minutes,
      COALESCE(o.minutes, p.default_minutes, 25) AS service_standard_minutes
    FROM dbo.MonitoredOnDemandWaits m
    LEFT JOIN dbo.OnDemandServiceStandardPolicy p ON p.id = 1
    LEFT JOIN dbo.OnDemandZoneServiceStandardOverrides o ON o.external_location_id = m.zone_id
      AND o.revoked_at IS NULL AND o.effective_at <= SYSUTCDATETIME() AND SYSUTCDATETIME() < o.expires_at
    WHERE m.monitor_state = 'active';
  `);
  for (const candidate of candidates.recordset) {
    const request = pool.request();
    request.input("request_id", sql.NVarChar(100), candidate.trip_id);
    const existing = await request.query<InterventionRow>(`
      SELECT status, projected_breach_count, suggested_alert_id
      FROM dbo.OnDemandServiceQualityInterventions WHERE request_id = @request_id;
    `);
    const prior = existing.recordset[0];
    const { projectedBreachCount: projectedCount, needsIntervention } = onDemandInterventionDecision(
      prior?.projected_breach_count ?? 0,
      candidate.current_wait_minutes,
      candidate.predicted_wait_minutes,
      candidate.service_standard_minutes,
    );

    if (!needsIntervention) {
      if (prior?.status === "open") {
        const resolve = pool.request();
        resolve.input("request_id", sql.NVarChar(100), candidate.trip_id);
        resolve.input("reconciled_at", sql.DateTime2, reconciledAt);
        await resolve.query(`
          UPDATE dbo.OnDemandServiceQualityInterventions
          SET status = 'resolved', resolved_at = @reconciled_at, resolved_by = 'System.Ingestion',
            resolution_reason = 'Recovered in authoritative reconciliation.', last_authoritative_at = @reconciled_at, updated_at = SYSUTCDATETIME()
          WHERE request_id = @request_id;
        `);
      } else {
        const update = pool.request();
        update.input("request_id", sql.NVarChar(100), candidate.trip_id);
        update.input("projected_count", sql.Int, projectedCount);
        update.input("reconciled_at", sql.DateTime2, reconciledAt);
        await update.query(`
          UPDATE dbo.OnDemandServiceQualityInterventions
          SET projected_breach_count = @projected_count, last_authoritative_at = @reconciled_at, updated_at = SYSUTCDATETIME()
          WHERE request_id = @request_id;
        `);
      }
      continue;
    }

    const alertId = prior?.suggested_alert_id ?? await ensureSuggestedAlert(pool, candidate);
    const upsert = pool.request();
    upsert.input("request_id", sql.NVarChar(100), candidate.trip_id);
    upsert.input("projected_count", sql.Int, projectedCount);
    upsert.input("alert_id", sql.UniqueIdentifier, alertId);
    upsert.input("reconciled_at", sql.DateTime2, reconciledAt);
    await upsert.query(`
      MERGE dbo.OnDemandServiceQualityInterventions WITH (HOLDLOCK) AS target
      USING (SELECT @request_id AS request_id) AS source ON target.request_id = source.request_id
      WHEN MATCHED THEN UPDATE SET status = 'open', projected_breach_count = @projected_count,
        suggested_alert_id = @alert_id, last_authoritative_at = @reconciled_at,
        resolved_at = NULL, resolved_by = NULL, resolution_reason = NULL, updated_at = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN INSERT (request_id, status, projected_breach_count, suggested_alert_id, last_authoritative_at)
        VALUES (@request_id, 'open', @projected_count, @alert_id, @reconciled_at);
    `);
    const link = pool.request();
    link.input("request_id", sql.NVarChar(100), candidate.trip_id);
    link.input("alert_id", sql.UniqueIdentifier, alertId);
    await link.query("UPDATE dbo.MonitoredOnDemandWaits SET suggested_alert_id = @alert_id WHERE trip_id = @request_id;");
  }

  const resolveTerminal = pool.request();
  resolveTerminal.input("reconciled_at", sql.DateTime2, reconciledAt);
  await resolveTerminal.query(`
    UPDATE i SET status = 'resolved', resolved_at = @reconciled_at, resolved_by = 'System.Ingestion',
      resolution_reason = 'The request became terminal in authoritative reconciliation.',
      last_authoritative_at = @reconciled_at, updated_at = SYSUTCDATETIME()
    FROM dbo.OnDemandServiceQualityInterventions i
    JOIN dbo.MonitoredOnDemandWaits m ON m.trip_id = i.request_id
    WHERE i.status = 'open' AND m.monitor_state <> 'active';
  `);
}
