// GET /feed-checks - any OnBoard role, PII-free upstream feed diagnostics.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { requireAnyOnBoardAccess } from "../lib/access/require";
import { probeAvail } from "../lib/availClient";
import { getPool } from "../lib/db";
import { probeGtfsRtFeed } from "../lib/gtfsRtReader";
import { ledgerFeedChecks, summarizeFeedResponse, type FeedCheck } from "../lib/feedCheckResponse";
import { feedHealthTableReady } from "../lib/kpiFeedHealth";
import { loadKpiFeedHealthRecords } from "../lib/kpiTrustStore";
import { missedTripDetectionSettings } from "../lib/missedTripCase";
import {
  DEFAULT_OTP_MEASUREMENT_PARAMETERS,
  parameterSegments,
  readParametersInForce,
} from "../lib/otpMeasurementParameters";
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

async function spareMissedTripPipelineChecks(): Promise<FeedCheck[]> {
  const configured = missedTripDetectionSettings().spareEnabled;
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

// The 30-second prediction capture, from its ledger row: when it last wrote,
// what it wrote, and why not when it is stale.
async function predictionCaptureCheck(): Promise<FeedCheck> {
  const name = "Prediction capture";
  if (!predictionCaptureAccount()) return { name, configured: false, error: `${PREDICTION_CAPTURE_ACCOUNT_SETTING} is not set` };
  try {
    const pool = await getPool();
    if (!await feedHealthTableReady(pool)) return { name, configured: true, error: "Pipeline health table is not ready" };
    return ledgerFeedChecks([{ name, feedName: "prediction_capture" }], await loadKpiFeedHealthRecords(pool))[0];
  } catch (error) {
    return { name, configured: true, error: error instanceof Error ? error.message : "Capture health check failed" };
  }
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

// A connection check must not fail because the register could not be read, so
// an unreachable database answers with the compiled default rather than
// throwing. That is the same fallback the pollers take.
async function otpParametersForProbe(): Promise<string> {
  try {
    return (await readParametersInForce(await getPool())).segments;
  } catch {
    return parameterSegments(DEFAULT_OTP_MEASUREMENT_PARAMETERS);
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

    // The OTP probes have to send the measurement standard the polls send, or a
    // passing check would be testing a different request than the one that
    // matters (ADR 0042). A database that cannot answer falls back to the
    // compiled default, as the polls do.
    const otpParameters = await otpParametersForProbe();

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
      probeAvail("otp_monthly", { month: now, parameters: otpParameters }),
      probeAvail("otp_daily", { start: yesterday, end: yesterday, parameters: otpParameters }),
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
