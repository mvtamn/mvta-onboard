// GET /feed-checks - staff-only, PII-free upstream feed diagnostics.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { requireRole, STAFF_READ_ROLES } from "../lib/auth";
import { getPool } from "../lib/db";
import { ledgerFeedChecks, summarizeFeedResponse, type FeedCheck } from "../lib/feedCheckResponse";
import { feedHealthTableReady } from "../lib/kpiFeedHealth";
import { loadKpiFeedHealthRecords } from "../lib/kpiTrustStore";
import { fetchSparePage, type SpareRequestRecord } from "../lib/spareApi";

function dateMmDdYyyy(date: Date): string {
  return `${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}-${date.getUTCFullYear()}`;
}

function chicagoDateTime(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${value("year")}-${value("month")}-${value("day")}%20${value("hour")}:${value("minute")}:${value("second")}`;
}

async function checkJson(name: string, url: string, auth?: Record<string, string>): Promise<FeedCheck> {
  try {
    const response = await fetch(url, {
      headers: auth,
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) return { name, configured: true, status: response.status };
    const summary = summarizeFeedResponse(await response.json());
    return { name, configured: true, status: response.status, ...summary };
  } catch (error) {
    return { name, configured: true, error: error instanceof Error ? error.message : "Request failed" };
  }
}

async function checkStaticGtfs(url: string | undefined): Promise<FeedCheck> {
  if (!url?.trim()) return { name: "GTFS static", configured: false };
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    return { name: "GTFS static", configured: true, status: response.status, records: Number(response.headers.get("content-length") ?? 0) };
  } catch (error) {
    return { name: "GTFS static", configured: true, error: error instanceof Error ? error.message : "Request failed" };
  }
}

// Probed through the same client the ingests use, so the check follows
// SPARE_API_BASE_URL, auth and timeout exactly as they do rather than calling
// a hard-coded host of its own.
async function checkSpareRequests(nowSeconds: number): Promise<FeedCheck> {
  const name = "Spare Requests";
  if (!process.env.SPARE_API_KEY?.trim()) return { name, configured: false, error: "API key unavailable" };
  try {
    const page = await fetchSparePage<SpareRequestRecord>("/v1/requests", new URLSearchParams({
      fromUpdatedAt: String(nowSeconds - 7200),
      toUpdatedAt: String(nowSeconds),
      limit: "1",
      skip: "0",
    }));
    return { name, configured: true, status: 200, ...summarizeFeedResponse(page) };
  } catch (error) {
    return { name, configured: true, error: error instanceof Error ? error.message : "Request failed" };
  }
}

async function spareMissedTripPipelineChecks(): Promise<FeedCheck[]> {
  const configured = process.env.SPARE_MISSED_TRIPS_ENABLED?.trim().toLowerCase() === "true";
  if (!configured) {
    return ["Requests", "Slots"].map((name) => ({ name: `Spare missed-trip ${name} ingestion`, configured: false }));
  }
  try {
    const pool = await getPool();
    if (!await feedHealthTableReady(pool)) {
      return ["Requests", "Slots"].map((name) => ({ name: `Spare missed-trip ${name} ingestion`, configured: true, error: "Pipeline health table is not ready" }));
    }
    return ledgerFeedChecks([
      { name: "Spare missed-trip Requests ingestion", feedName: "spare_requests" },
      { name: "Spare missed-trip Slots ingestion", feedName: "spare_slots" },
    ], await loadKpiFeedHealthRecords(pool));
  } catch (error) {
    return ["Requests", "Slots"].map((name) => ({
      name: `Spare missed-trip ${name} ingestion`, configured: true,
      error: error instanceof Error ? error.message : "Pipeline health check failed",
    }));
  }
}

app.http("feedChecks", {
  route: "feed-checks",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (request: HttpRequest, _context: InvocationContext) => {
    const auth = requireRole(request, STAFF_READ_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };

    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const weekAgo = new Date(now);
    weekAgo.setUTCDate(weekAgo.getUTCDate() - 7);
    const key = process.env.AVAIL_AVL_REPORTS_API_KEY?.trim();
    const configured = (name: string, url: string | undefined) => url?.trim()
      ? key ? checkJson(name, url.trim(), { "Ocp-Apim-Subscription-Key": key }) : Promise.resolve({ name, configured: false, error: "Subscription key unavailable" } satisfies FeedCheck)
      : Promise.resolve({ name, configured: false } satisfies FeedCheck);
    const avlStart = new Date(now.getTime() - 10 * 60_000);
    const nowSeconds = Math.floor(now.getTime() / 1000);

    const [checks, sparePipelineChecks] = await Promise.all([
      Promise.all([
      checkJson("GTFS TripUpdates", process.env.GTFS_RT_TRIPUPDATE_URL?.trim() ?? ""),
      checkJson("GTFS VehiclePositions", process.env.GTFS_RT_VEHICLE_URL?.trim() ?? ""),
      checkJson("GTFS Alerts", process.env.GTFS_RT_ALERT_URL?.trim() ?? ""),
      checkStaticGtfs(process.env.GTFS_STATIC_URL),
      configured("Avail AVL", process.env.AVAIL_AVL_REPORTS_URL?.trim()
        ? `${process.env.AVAIL_AVL_REPORTS_URL!.trim().replace(/\/+$/, "")}/MVTA/${chicagoDateTime(avlStart)}/${chicagoDateTime(now)}`
        : undefined),
      configured("Avail Pullout", process.env.AVAIL_PULLOUT_URL),
      configured("Avail OTP Monthly", process.env.AVAIL_OTP_MONTHLY_URL?.trim()
        ? `${process.env.AVAIL_OTP_MONTHLY_URL!.trim()}/${dateMmDdYyyy(now)}/1/5/15/30/0/1/1`
        : undefined),
      configured("Avail OTP Daily", process.env.AVAIL_OTP_DAILY_URL?.trim()
        ? `${process.env.AVAIL_OTP_DAILY_URL!.trim()}/${dateMmDdYyyy(yesterday)}/${dateMmDdYyyy(yesterday)}/1/5/15/30/0/1/1`
        : undefined),
      configured("Avail Missed Trips", process.env.AVAIL_MISSED_TRIPS_URL?.trim()
        ? `${process.env.AVAIL_MISSED_TRIPS_URL!.trim()}/${dateMmDdYyyy(weekAgo)}/${dateMmDdYyyy(now)}/0/0`
        : undefined),
      checkSpareRequests(nowSeconds),
      ]),
      spareMissedTripPipelineChecks(),
    ]);
    return { status: 200, jsonBody: { checked_at: now.toISOString(), checks: [...checks, ...sparePipelineChecks] } };
  },
});
