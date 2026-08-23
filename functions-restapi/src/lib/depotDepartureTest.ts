import type { InvocationContext } from "@azure/functions";
import { getPool, sql } from "./db";
import { detectQualifiedBoundaryMovements } from "./eventBoundaryMovement";
import { isStableTransition, nextTransitionConfirmations } from "./eventProcessing";
import { polygonContains } from "./geofence";
import { formatTeamsWebhookPayload, isTransientNotificationFailure, retryDelaySeconds } from "./eventNotificationPolicy";

const TEST_MESSAGE_COOLDOWN_SECONDS = 60;

interface Watch { id: string; location_name: string; geofence_name: string; polygon: string; expires_at: Date; active_since: Date }
interface Position { vehicle_id: number; route: number | null; latitude: number; longitude: number; heading: number | null; report_timestamp: Date }
interface PreviousPosition { latitude: number; longitude: number; report_timestamp: Date }

export function formatDepotDepartureTestMessage(input: { vehicleId: number; routeId: number | null; locationName: string; geofenceName: string; exitedAt: Date | string }): string {
  const route = input.routeId === null ? "" : ` on Route ${input.routeId}`;
  const exitedAt = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "2-digit", day: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true, timeZoneName: "short" }).format(new Date(input.exitedAt));
  return `[TEST] Bus ${input.vehicleId}${route} exited ${input.geofenceName} at ${input.locationName}.\n\nDepot departure test · Detected: ${exitedAt}`;
}

export function depotTestIsActive(expiresAt: Date | string, now = new Date()): boolean {
  return new Date(expiresAt).getTime() > now.getTime();
}

export function reportOccurredDuringDepotTest(reportTimestamp: Date | string, activeSince: Date | string): boolean {
  return new Date(reportTimestamp).getTime() > new Date(activeSince).getTime();
}

async function previousPosition(pool: Awaited<ReturnType<typeof getPool>>, position: Position): Promise<PreviousPosition | undefined> {
  return (await pool.request().input("vehicle", sql.Int, position.vehicle_id).input("reported", sql.DateTime2, position.report_timestamp).query<PreviousPosition>(`
    SELECT TOP (1) latitude,longitude,report_timestamp FROM EventVehiclePositionHistory
    WHERE vehicle_id=@vehicle AND report_timestamp < @reported ORDER BY report_timestamp DESC
  `)).recordset[0];
}

async function recordDeparture(pool: Awaited<ReturnType<typeof getPool>>, watch: Watch, position: Position): Promise<void> {
  const body = formatDepotDepartureTestMessage({ vehicleId: position.vehicle_id, routeId: position.route, locationName: watch.location_name, geofenceName: watch.geofence_name, exitedAt: position.report_timestamp });
  const request = pool.request();
  request.input("test", sql.UniqueIdentifier, watch.id); request.input("vehicle", sql.Int, position.vehicle_id); request.input("route", sql.Int, position.route); request.input("exited", sql.DateTime2, position.report_timestamp); request.input("body", sql.NVarChar, body); request.input("cooldown", sql.Int, TEST_MESSAGE_COOLDOWN_SECONDS);
  await request.query(`
    SET XACT_ABORT ON; BEGIN TRANSACTION;
    DECLARE @notify BIT=0;
    SELECT @notify=CASE WHEN last_notified_at IS NULL OR last_notified_at <= DATEADD(SECOND,-@cooldown,@exited) THEN 1 ELSE 0 END
    FROM EventDepotDepartureTestVehicleState WITH (UPDLOCK,HOLDLOCK) WHERE test_id=@test AND vehicle_id=@vehicle;
    IF @notify=1
    BEGIN
      UPDATE EventDepotDepartureTestVehicleState SET last_notified_at=@exited WHERE test_id=@test AND vehicle_id=@vehicle;
      INSERT EventDepotDepartureTestMessages(test_id,vehicle_id,route_id,exited_at,message_body) VALUES(@test,@vehicle,@route,@exited,@body);
    END;
    COMMIT TRANSACTION;
  `);
}

async function updateState(pool: Awaited<ReturnType<typeof getPool>>, watch: Watch, position: Position, inside: boolean, pending: boolean | null, confirmations: number): Promise<void> {
  const request = pool.request();
  request.input("test", sql.UniqueIdentifier, watch.id); request.input("vehicle", sql.Int, position.vehicle_id); request.input("inside", sql.Bit, inside); request.input("pending", sql.Bit, pending); request.input("confirmations", sql.Int, confirmations); request.input("reported", sql.DateTime2, position.report_timestamp);
  await request.query(`UPDATE EventDepotDepartureTestVehicleState SET is_inside=@inside,pending_is_inside=@pending,pending_confirmations=@confirmations,last_report_timestamp=@reported,updated_at=SYSUTCDATETIME() WHERE test_id=@test AND vehicle_id=@vehicle`);
}

export async function detectDepotDepartureTests(context: InvocationContext): Promise<void> {
  const pool = await getPool();
  const pollSeconds = (await pool.request().query<{ seconds: number }>("SELECT COALESCE(TRY_CONVERT(INT, setting_value),30) seconds FROM AppSettings WHERE module='event' AND setting_key='poll_interval_seconds'")).recordset[0]?.seconds ?? 30;
  const watches = (await pool.request().query<Watch>(`
    SELECT t.id,l.name location_name,g.name geofence_name,g.polygon,t.expires_at,t.updated_at active_since
    FROM EventDepotDepartureTests t JOIN EventLocations l ON l.id=t.location_id JOIN EventGeofences g ON g.id=t.geofence_id
    WHERE t.is_enabled=1 AND t.expires_at>SYSUTCDATETIME() AND l.is_active=1 AND g.is_active=1
  `)).recordset;
  if (!watches.length) { await deliverPendingDepotDepartureTestMessages(context); return; }
  const positions = (await pool.request().query<Position>("SELECT vehicle_id,route,latitude,longitude,heading,report_timestamp FROM EventVehicleCurrentPosition WHERE report_timestamp>=DATEADD(MINUTE,-3,SYSUTCDATETIME())")).recordset;
  for (const watch of watches) for (const position of positions) {
    if (!reportOccurredDuringDepotTest(position.report_timestamp, watch.active_since)) continue;
    let inside: boolean;
    try { inside = polygonContains(watch.polygon, [position.longitude, position.latitude]); } catch { continue; }
    const state = (await pool.request().input("test", sql.UniqueIdentifier, watch.id).input("vehicle", sql.Int, position.vehicle_id).query<{ is_inside: boolean; pending_is_inside: boolean | null; pending_confirmations: number; last_report_timestamp: Date | null }>("SELECT is_inside,pending_is_inside,pending_confirmations,last_report_timestamp FROM EventDepotDepartureTestVehicleState WHERE test_id=@test AND vehicle_id=@vehicle")).recordset[0];
    if (state?.last_report_timestamp && position.report_timestamp <= state.last_report_timestamp) continue;
    const prior = await previousPosition(pool, position);
    const movements = prior && reportOccurredDuringDepotTest(prior.report_timestamp, watch.active_since)
      ? detectQualifiedBoundaryMovements(watch.polygon, { previous: prior, current: position, pollIntervalSeconds: pollSeconds }) : [];
    // A depot test is deliberately narrower than an Event boundary alert: a
    // bus must have been in the depot before it can be reported as leaving it.
    // This excludes an outside-to-outside path that merely passes through the
    // depot area between polls.
    const wasPreviouslyInside = prior ? polygonContains(watch.polygon, [prior.longitude, prior.latitude]) : false;
    const exitedAlongPath = movements.some((movement) => movement.transition === "exit");
    if (!state) {
      const seed = pool.request(); seed.input("test", sql.UniqueIdentifier, watch.id); seed.input("vehicle", sql.Int, position.vehicle_id); seed.input("inside", sql.Bit, inside); seed.input("reported", sql.DateTime2, position.report_timestamp);
      await seed.query("INSERT EventDepotDepartureTestVehicleState(test_id,vehicle_id,is_inside,last_report_timestamp) VALUES(@test,@vehicle,@inside,@reported)");
      if (wasPreviouslyInside && exitedAlongPath) await recordDeparture(pool, watch, position);
      continue;
    }
    if (movements.length) {
      await updateState(pool, watch, position, inside, null, 0);
      if (state.is_inside && exitedAlongPath) await recordDeparture(pool, watch, position);
      continue;
    }
    const pending = state.pending_is_inside === inside ? state.pending_confirmations : 0;
    const confirmations = nextTransitionConfirmations(state.is_inside, inside, pending);
    const stable = isStableTransition(state.is_inside, inside, pending);
    await updateState(pool, watch, position, stable ? inside : state.is_inside, stable ? null : inside, stable ? 0 : confirmations);
    if (stable && !inside) await recordDeparture(pool, watch, position);
  }
  await deliverPendingDepotDepartureTestMessages(context);
}

export async function deliverPendingDepotDepartureTestMessages(context: InvocationContext): Promise<void> {
  const pool = await getPool();
  const rows = (await pool.request().query<{ id: number; message_body: string; attempt_count: number }>(`
    UPDATE m SET status='expired',last_error=CASE WHEN t.is_enabled=0 OR t.expires_at<=SYSUTCDATETIME() THEN 'Depot departure test stopped or expired' ELSE 'Test delivery retry window expired' END,next_attempt_at=NULL
    FROM EventDepotDepartureTestMessages m JOIN EventDepotDepartureTests t ON t.id=m.test_id
    WHERE m.status='pending' AND (t.is_enabled=0 OR t.expires_at<=SYSUTCDATETIME() OR m.created_at<=DATEADD(HOUR,-24,SYSUTCDATETIME()));
    SELECT TOP (20) m.id,m.message_body,m.attempt_count FROM EventDepotDepartureTestMessages m
    JOIN EventDepotDepartureTests t ON t.id=m.test_id
    WHERE m.status='pending' AND t.is_enabled=1 AND t.expires_at>SYSUTCDATETIME() AND (m.next_attempt_at IS NULL OR m.next_attempt_at<=SYSUTCDATETIME()) ORDER BY m.created_at;
  `)).recordset;
  const webhook = process.env.TEAMS_EVENT_WEBHOOK_URL;
  for (const row of rows) {
    let response: Response;
    if (!webhook) response = new Response(null, { status: 503 });
    else try { response = await fetch(webhook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(formatTeamsWebhookPayload(row.message_body)) }); }
    catch (error) { context.error("Depot departure test Teams delivery failed", error); response = new Response(null, { status: 599 }); }
    const transient = isTransientNotificationFailure(response.status);
    const request = pool.request(); request.input("id", sql.BigInt, row.id); request.input("status", sql.NVarChar, response.ok ? "sent" : transient ? "pending" : "failed"); request.input("error", sql.NVarChar, `Teams webhook returned ${response.status}`); request.input("delay", sql.Int, retryDelaySeconds(row.attempt_count + 1));
    await request.query("UPDATE EventDepotDepartureTestMessages SET status=@status,sent_at=CASE WHEN @status='sent' THEN SYSUTCDATETIME() ELSE sent_at END,attempt_count=attempt_count+1,last_error=CASE WHEN @status='sent' THEN NULL ELSE @error END,next_attempt_at=CASE WHEN @status='pending' THEN DATEADD(SECOND,@delay,SYSUTCDATETIME()) ELSE NULL END WHERE id=@id AND status='pending'");
  }
}
