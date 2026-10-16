// Every 30 seconds: write down the arrival predictions riders are shown and
// where every bus is, so prediction accuracy can be scored the next night
// (plans/prediction-accuracy-evaluation.md, increment 1; lib/predictionAccuracy).
//
// VehiclePositions (11 KB) are read on every run, because an arrival is
// derived from when a bus's stop sequence moves past a stop, and 30 seconds
// is the precision that buys. TripUpdates (420 KB of debug JSON) are read on
// the :20 run only: one prediction sample a minute is the benchmark's usual
// cadence, and it halves what we pull from srv.mvta.com.
//
// At :20 and :50 past the minute, not :00 and :30. Every other timer in this
// app fires on second 0 (the one-minute trip-start poll reads TripUpdates
// there, and four five-minute pollers read the same server on every fifth
// minute), and Event AVL polls at :00/:15/:30/:45. Running on :00 in the first
// hour live, the capture's TripUpdates runs took 19-62 s against 1-10 s for
// the others - 62 s on a fifth-minute boundary - and so skipped runs.
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
import { appendCapture, predictionCaptureAccount, PREDICTION_CAPTURE_ACCOUNT_SETTING } from "../lib/predictionAccuracy/captureStore";

/** Shorter than the 30 s cadence, so a slow feed fails its run rather than overlapping the next. */
const FETCH_TIMEOUT_MS = 20_000;

// Said once per process, not every 30 seconds.
let warnedUnconfigured = false;

app.timer("predictionCapture", {
  schedule: "20,50 * * * * *",
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
      await appendCapture(account, captureBlobName(runAt), captured.lines);
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
