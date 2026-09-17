// Timer-triggered fixed-route missed-trip detection. The GTFS adapter reports
// what the TripUpdate feed, the static schedule and the operational evidence
// show - explicit cancellations, trips past their deadline with no start (and
// whether the detector could decide), and trip starts - and the Missed-trip
// case module decides what that means for each case. See
// lib/missedTripCase/adapters/gtfs.ts for the detection rules and
// lib/missedTripCase/decide.ts for the case rules.
//
// This is a compliance/investigation tool, not a customer-alert feed: a case is
// only saved for staff to review. It does NOT auto-insert into SuggestedAlerts -
// preparing a rider notice is a separate, explicit staff action.
import { app, type InvocationContext, type Timer } from "@azure/functions";
import { getPool } from "../lib/db";
import { gtfsRtFeedUrl, gtfsRtUrlSetting, readTripUpdateDelivery } from "../lib/gtfsRtReader";
import { observeMissedTrips } from "../lib/missedTripCase";
import { gtfsObservations, silentNoShowEnabled } from "../lib/missedTripCase/adapters/gtfs";

app.timer("gtfsMissedTripsPoll", {
  schedule: "0 */5 * * * *",
  handler: async (_timer: Timer, context: InvocationContext) => {
    const feedUrl = gtfsRtFeedUrl("trip_updates");
    if (!feedUrl) {
      context.warn(`${gtfsRtUrlSetting("trip_updates")} is not configured - skipping this run.`);
      return;
    }
    const delivery = await readTripUpdateDelivery(feedUrl, context);
    if (!delivery) return;
    const { feed } = delivery;
    const pool = await getPool();

    const noShowEnabled = silentNoShowEnabled();
    if (!noShowEnabled) {
      context.warn("GTFS silent-no-show detection is paused (GTFS_SILENT_NO_SHOW_ENABLED is not true); explicit cancellations remain active.");
    }
    const { observations, tally } = await gtfsObservations(pool, feed.Entities, context);
    if (tally.undecidedBy.size > 0) {
      const detail = [...tally.undecidedBy.entries()].map(([reason, count]) => `${reason}=${count}`).join(", ");
      context.warn(`Silent no-show detection could not decide ${tally.undecidable} past-deadline trip(s) (${detail}). ${tally.warnings.join(" ")}`);
    }
    if (tally.undatedCancellations > 0) {
      context.warn(`${tally.undatedCancellations} cancelled trip(s) in the feed carry no service date and were not recorded.`);
    }
    const report = await observeMissedTrips(pool, observations);
    for (const failure of report.failed) {
      context.error(`Failed to record missed-trip case ${failure.runId} on ${failure.serviceDate}:`, failure.error);
    }
    context.log(
      `Missed-trip poll: ${feed.Entities.length} entities seen; observed ${tally.cancellations} cancellations, ` +
        `${tally.noShows} past-deadline trips without a start, ${tally.undecidable} undecidable, ${tally.tripStarts} trip starts ` +
        `(silent no-show enabled=${noShowEnabled}). Cases: ${report.created} created, ${report.held} held, ` +
        `${report.confirmed} confirmed, ${report.closedByEvidence} closed by evidence, ${report.evidenceRecorded} evidence recorded, ` +
        `${report.skippedChanged} changed elsewhere, ${report.failed.length} failed.`,
    );
  },
});
