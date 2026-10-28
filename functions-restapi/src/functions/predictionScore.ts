// Nightly: score the service day that just ended with the ETA Accuracy
// Benchmark (plans/prediction-accuracy-evaluation.md increment 2, ADR 0041).
//
// 09:15 UTC is 04:15 CDT / 03:15 CST: after the 03:00 Central service-day
// cutoff in both, so the last trip past midnight is in, and before the
// morning peak loads the REST worker. It reads the day's capture file and the
// next day's (where trips after midnight are written), derives each bus's
// arrivals, scores every prediction and replaces that day's tallies in SQL.
//
// It also scores any of the six days before that has a capture file and no
// score yet: a night the scorer missed, or the days before migration 147 was
// applied, are caught up rather than lost. The capture is kept 90 days, so a
// day can be rescored by deleting its PredictionAccuracyDays row.
//
// On the ledger as `prediction_score`, shown on Integrations & Data Health.
import { app, type InvocationContext, type Timer } from "@azure/functions";
import { getPool } from "../lib/db";
import { runFeedIngestion } from "../lib/feedRun";
import { agencyServiceDate } from "../lib/missedTripTime";
import { captureBlobName } from "../lib/predictionAccuracy/capture";
import { parseCapture } from "../lib/predictionAccuracy/captureFile";
import { predictionCaptureAccount, PREDICTION_CAPTURE_ACCOUNT_SETTING, readCapture } from "../lib/predictionAccuracy/captureStore";
import { scoreServiceDay } from "../lib/predictionAccuracy/score";
import { loadTripDirections, predictionAccuracyReady, scoredServiceDates, writeDayScore } from "../lib/predictionAccuracy/store";
import { benchmark } from "../lib/predictionAccuracy/benchmark";

/** Days before yesterday that are scored if they have a capture and no score. */
const CATCH_UP_DAYS = 6;

/** The capture file named for a service date (yyyymmdd), as captureBlobName names it. */
function fileFor(serviceDate: string): string {
  const y = Number(serviceDate.slice(0, 4));
  const m = Number(serviceDate.slice(4, 6));
  const d = Number(serviceDate.slice(6, 8));
  // 17:00 UTC is 11:00 or 12:00 Central: the same calendar date all year.
  return captureBlobName(new Date(Date.UTC(y, m - 1, d, 17, 0, 0)));
}

function nextDate(serviceDate: string): string {
  const y = Number(serviceDate.slice(0, 4));
  const m = Number(serviceDate.slice(4, 6));
  const d = Number(serviceDate.slice(6, 8));
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return `${next.getUTCFullYear()}${String(next.getUTCMonth() + 1).padStart(2, "0")}${String(next.getUTCDate()).padStart(2, "0")}`;
}

function percent(share: number | null): string {
  return share === null ? "n/a" : `${(share * 100).toFixed(1)}%`;
}

app.timer("predictionScore", {
  schedule: "0 15 9 * * *",
  handler: async (_timer: Timer, context: InvocationContext) => {
    const account = predictionCaptureAccount();
    if (!account) {
      context.warn(`Prediction scoring is off: it needs ${PREDICTION_CAPTURE_ACCOUNT_SETTING}.`);
      return;
    }
    const pool = await getPool();
    if (!await predictionAccuracyReady(pool)) {
      context.warn("Prediction scoring is off: PredictionAccuracyDays is missing - run sql/migration-147-prediction-accuracy-daily.sql. The capture is kept for 90 days, so nothing is lost meanwhile.");
      return;
    }

    await runFeedIngestion("prediction_score", context, async () => {
      const now = new Date();
      const yesterday = agencyServiceDate(now, -1).serviceDate;
      const oldest = agencyServiceDate(now, -1 - CATCH_UP_DAYS).serviceDate;
      const scored = await scoredServiceDates(pool, oldest);
      const dates = [yesterday];
      for (let offset = 2; offset <= CATCH_UP_DAYS + 1; offset++) {
        const date = agencyServiceDate(now, -offset).serviceDate;
        if (!scored.has(date)) dates.push(date);
      }

      const directions = await loadTripDirections(pool);
      let scoredPredictions = 0;
      let days = 0;
      // The ledger's source time: the newest capture run scored tonight.
      let lastRunAt: number | null = null;
      for (const date of dates) {
        const lines = await readCapture(account, fileFor(date));
        if (!lines) continue;
        const after = (await readCapture(account, fileFor(nextDate(date)))) ?? [];
        const parsed = parseCapture([...lines, ...after]);
        const day = scoreServiceDay(date, parsed.records, directions);
        await writeDayScore(pool, day, parsed.unreadable, new Date());
        const agency = benchmark(day.tallies);
        context.log(
          `Prediction accuracy ${date}: ${percent(agency.overall)} overall over ${day.scored} predictions ` +
            `(0-3 ${percent(agency.buckets["0-3"])}, 3-6 ${percent(agency.buckets["3-6"])}, 6-10 ${percent(agency.buckets["6-10"])}, 10-15 ${percent(agency.buckets["10-15"])}); ` +
            `${day.indeterminate} indeterminate, ${day.noActual.noVehicle + day.noActual.unseen + day.noActual.notReached + day.noActual.gap} without an actual, ` +
            `${day.stale} from stale feeds; ${day.runs} capture runs; Avail's kept times agree with ${day.crossCheck.agreed} of ${day.crossCheck.compared} derived arrivals.`,
        );
        scoredPredictions += day.scored;
        days++;
        if (day.lastRunAt !== null && (lastRunAt === null || day.lastRunAt > lastRunAt)) lastRunAt = day.lastRunAt;
      }
      if (days === 0) return { kind: "skipped", reason: `No capture file for ${yesterday} or the ${CATCH_UP_DAYS} unscored days before it.` };
      return { kind: "stored", received: scoredPredictions, stored: scoredPredictions, noun: "scored predictions", sourceTimestampSeconds: lastRunAt };
    });
  },
});
