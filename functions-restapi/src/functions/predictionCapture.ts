// Every 30 seconds: write down the arrival predictions riders are shown and
// where every bus is, so prediction accuracy can be scored the next night
// (plans/prediction-accuracy-evaluation.md, increment 1; lib/predictionAccuracy).
//
// VehiclePositions (11 KB) are read on every run, because an arrival is
// derived from when a bus's stop sequence moves past a stop, and 30 seconds
// is the precision that buys. TripUpdates (420 KB of debug JSON) are read on
// the :00 run only: one prediction sample a minute is the benchmark's usual
// cadence, and it halves what we pull from srv.mvta.com.
//
// Logged at Warning (host.json): 2,880 runs a day of "Executing/Executed"
// would be noise. What it captured is on the ledger as `prediction_capture`,
// shown on Integrations & Data Health.
//
// Writes only to its own blob container. It reads the same feeds the
// five-minute polls do, through the same reader, and records nothing on their
// ledger rows: those mean the five-minute polls' deliveries.
import { app, type InvocationContext, type Timer } from "@azure/functions";
import { fetchGtfsRtFeed, gtfsRtFeedUrl } from "../lib/gtfsRtReader";
import { runFeedIngestion } from "../lib/feedRun";
import { captureBlobName, captureLines, readsTripUpdates } from "../lib/predictionAccuracy/capture";
import {
  appendCapture,
  createWriteGate,
  notAuthorizedReason,
  predictionCaptureAccount,
  PREDICTION_CAPTURE_ACCOUNT_SETTING,
} from "../lib/predictionAccuracy/captureStore";

/** Shorter than the 30 s cadence, so a slow feed fails its run rather than overlapping the next. */
const FETCH_TIMEOUT_MS = 20_000;

// Said once per process, not every 30 seconds.
let warnedUnconfigured = false;
// Shut for 15 minutes after the account refuses a write (a missing role), so
// a refusal is one ledger failure and one error a quarter-hour, not an
// exception every 30 seconds.
const writeGate = createWriteGate();

app.timer("predictionCapture", {
  schedule: "*/30 * * * * *",
  handler: async (_timer: Timer, context: InvocationContext) => {
    const account = predictionCaptureAccount();
    const tripUpdatesUrl = gtfsRtFeedUrl("trip_updates");
    const vehiclesUrl = gtfsRtFeedUrl("vehicle_positions");
    if (!account || !tripUpdatesUrl || !vehiclesUrl) {
      if (!warnedUnconfigured) {
        context.warn(`Prediction capture is off: it needs ${PREDICTION_CAPTURE_ACCOUNT_SETTING}, GTFS_RT_TRIPUPDATE_URL and GTFS_RT_VEHICLE_URL.`);
        warnedUnconfigured = true;
      }
      return;
    }
    if (!writeGate.isOpen(Date.now())) return;

    await runFeedIngestion("prediction_capture", context, async () => {
      const runAt = new Date();
      const [tripUpdates, vehicles] = await Promise.allSettled([
        readsTripUpdates(runAt) ? fetchGtfsRtFeed("trip_updates", tripUpdatesUrl, { timeoutMs: FETCH_TIMEOUT_MS }) : Promise.resolve(null),
        fetchGtfsRtFeed("vehicle_positions", vehiclesUrl, { timeoutMs: FETCH_TIMEOUT_MS }),
      ]);
      if (tripUpdates.status === "rejected" && vehicles.status === "rejected") {
        return { kind: "failed", reason: `Both feeds failed: ${String(tripUpdates.reason)}; ${String(vehicles.reason)}` };
      }
      // One feed down still leaves a run worth writing: its R line records
      // the gap, so the scorer leaves those minutes out rather than guessing.
      if (tripUpdates.status === "rejected") context.warn("Prediction capture: TripUpdates failed this run:", tripUpdates.reason);
      if (vehicles.status === "rejected") context.warn("Prediction capture: VehiclePositions failed this run:", vehicles.reason);
      const tu = tripUpdates.status === "fulfilled" ? tripUpdates.value : null;
      const vp = vehicles.status === "fulfilled" ? vehicles.value : null;

      const captured = captureLines(runAt, tu, vp);
      try {
        await appendCapture(account, captureBlobName(runAt), captured.lines);
      } catch (err) {
        const refused = notAuthorizedReason(err, account);
        if (!refused) throw err;
        writeGate.close(Date.now());
        return { kind: "failed", reason: refused };
      }
      return {
        kind: "stored",
        received: captured.lines.length,
        stored: captured.lines.length,
        noun: "capture lines",
        sourceTimestampSeconds: vp?.Header.Timestamp ?? tu?.Header.Timestamp ?? null,
      };
    });
  },
});
