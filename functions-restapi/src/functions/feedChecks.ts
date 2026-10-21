// GET /feed-checks - any OnBoard role, PII-free upstream feed diagnostics.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { requireAnyOnBoardAccess } from "../lib/access/require";
import { probeAvail } from "../lib/availClient";
import { getPool } from "../lib/db";
import { probeGtfsRtFeed } from "../lib/gtfsRtReader";
import { ledgerFeedChecks, summarizeFeedResponse, type FeedCheck } from "../lib/feedCheckResponse";
import { feedHealthTableReady } from "../lib/kpiFeedHealth";
import type { KpiFeedName } from "../lib/kpiTrust";
import { loadKpiFeedHealthRecords } from "../lib/kpiTrustStore";
import { missedTripDetectionSettings } from "../lib/missedTripCase";
import { schemaDriftChecks } from "../lib/schemaDrift";
import { fetchSparePage, type SpareRequestRecord } from "../lib/spareApi";
import { predictionCaptureAccount, PREDICTION_CAPTURE_ACCOUNT_SETTING } from "../lib/predictionAccuracy/captureStore";

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

// A schema problem must not take the feed checks down with it: the rest of
// the page is still worth reading.
async function checkSchema(): Promise<FeedCheck[]> {
  try {
    return await schemaDriftChecks(await getPool());
  } catch (error) {
    return [{
      name: "Database schema",
      configured: true,
      error: error instanceof Error ? error.message : "Schema check failed",
    }];
  }
}

// Ledger-backed rows: unconfigured, the table not ready, or a read failure
// gives each row the same shape, so every caller says it the same way.
async function ledgerChecks(
  feeds: readonly { name: string; feedName: KpiFeedName }[],
  configured: boolean,
  unconfiguredError: string | undefined,
  failureError: string,
): Promise<FeedCheck[]> {
  const each = (fields: Partial<FeedCheck>): FeedCheck[] => feeds.map(({ name }) => ({ name, configured, ...fields }));
  if (!configured) return each(unconfiguredError ? { error: unconfiguredError } : {});
  try {
    const pool = await getPool();
    if (!await feedHealthTableReady(pool)) return each({ error: "Pipeline health table is not ready" });
    return ledgerFeedChecks(feeds, await loadKpiFeedHealthRecords(pool));
  } catch (error) {
    return each({ error: error instanceof Error ? error.message : failureError });
  }
}

function spareMissedTripPipelineChecks(): Promise<FeedCheck[]> {
  return ledgerChecks([
    { name: "Spare missed-trip Requests ingestion", feedName: "spare_requests" },
    { name: "Spare missed-trip Slots ingestion", feedName: "spare_slots" },
  ], missedTripDetectionSettings().spareEnabled, undefined, "Pipeline health check failed");
}

// The 30-second prediction capture, from its ledger row: when it last wrote,
// what it wrote, and why not when it is stale.
async function predictionCaptureCheck(): Promise<FeedCheck> {
  const [check] = await ledgerChecks(
    [{ name: "Prediction capture", feedName: "prediction_capture" }],
    Boolean(predictionCaptureAccount()),
    `${PREDICTION_CAPTURE_ACCOUNT_SETTING} is not set`,
    "Capture health check failed",
  );
  return check;
}

// The nightly prediction accuracy score, from its ledger row.
async function predictionScoreCheck(): Promise<FeedCheck> {
  const name = "Prediction accuracy scoring";
  if (!predictionCaptureAccount()) return { name, configured: false, error: `${PREDICTION_CAPTURE_ACCOUNT_SETTING} is not set` };
  try {
    const pool = await getPool();
    if (!await feedHealthTableReady(pool)) return { name, configured: true, error: "Pipeline health table is not ready" };
    return ledgerFeedChecks([{ name, feedName: "prediction_score" }], await loadKpiFeedHealthRecords(pool))[0];
  } catch (error) {
    return { name, configured: true, error: error instanceof Error ? error.message : "Scoring health check failed" };
  }
}

app.http("feedChecks", {
  route: "feed-checks",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (request: HttpRequest, _context: InvocationContext) => {
    const auth = await requireAnyOnBoardAccess(request);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };

    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const weekAgo = new Date(now);
    weekAgo.setUTCDate(weekAgo.getUTCDate() - 7);
    const avlStart = new Date(now.getTime() - 10 * 60_000);
    const nowSeconds = Math.floor(now.getTime() / 1000);

    const [checks, sparePipelineChecks, schemaChecks, captureCheck] = await Promise.all([
      Promise.all([
      // Through the reader the polls use: same setting, timeout and body checks.
      probeGtfsRtFeed("trip_updates"),
      probeGtfsRtFeed("vehicle_positions"),
      probeGtfsRtFeed("alerts"),
      checkStaticGtfs(process.env.GTFS_STATIC_URL),
      // Through the adapter the polls use, so each check sends the poll's own
      // request: same URL (including the /MVTA handling), auth and timeout.
      probeAvail("avl", { start: avlStart, end: now }),
      probeAvail("pullout", {}),
      probeAvail("otp_monthly", { month: now }),
      probeAvail("otp_daily", { start: yesterday, end: yesterday }),
      probeAvail("missed_trips", { start: weekAgo, end: now }),
      checkSpareRequests(nowSeconds),
      ]),
      spareMissedTripPipelineChecks(),
      // Whether this database has the schema the deployed code expects. A
      // merge can ship a read of a column nobody has applied yet, and nothing
      // else says so - see lib/schemaDrift.ts.
      checkSchema(),
      predictionCaptureCheck(),
      predictionScoreCheck(),
    ]);
    return {
      status: 200,
      jsonBody: { checked_at: now.toISOString(), checks: [...checks, ...sparePipelineChecks, captureCheck, ...schemaChecks] },
    };
  },
});
