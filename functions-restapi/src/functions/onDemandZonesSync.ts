// Daily import of the GTFS-Flex service-area geometry behind the on-demand wait
// monitor. Zone boundaries change once or twice a year, so this polls for a
// change rather than expecting one: an unchanged archive hashes to the version
// already stored and the run is a recorded no-op.
//
// It runs after gtfsStopsSync rather than alongside it - both pull sizeable
// archives, and nothing here depends on the static schedule.
import { app, type InvocationContext, type Timer } from "@azure/functions";
import { getPool } from "../lib/db";
import { runFeedIngestion } from "../lib/feedRun";
import { loadOperationalZonesFromGtfsFlexArchive } from "../lib/onDemandOperationalZones";
import { fetchGtfsFlexArchive, importOperationalZoneVersion, sourceSha256 } from "../lib/onDemandZoneImport";

app.timer("onDemandZonesSync", {
  schedule: "0 30 9 * * *",
  handler: async (_timer: Timer, context: InvocationContext) => {
    const feedUrl = process.env.ON_DEMAND_ZONE_FLEX_URL;
    if (!feedUrl) {
      context.warn(
        "ON_DEMAND_ZONE_FLEX_URL is not configured - skipping this run. " +
          "The on-demand wait monitor cannot resolve pickups to zones until a GTFS-Flex source is set.",
      );
      return;
    }

    let result: Awaited<ReturnType<typeof importOperationalZoneVersion>> | undefined;
    await runFeedIngestion("on_demand_zones", context, async () => {
      const archive = await fetchGtfsFlexArchive(feedUrl);
      // The hash covers the raw archive bytes, so it has to be taken before
      // parsing - it is what makes a re-import of identical geometry a no-op.
      const imported = await importOperationalZoneVersion(
        await getPool(),
        loadOperationalZonesFromGtfsFlexArchive(archive),
        sourceSha256(archive),
        "onDemandZonesSync",
      );
      result = imported;
      // This ledger records ingestion, not what is in force: the count is the
      // zones the imported version carries. An import that lands but waits for
      // activation leaves the monitor on the previous geometry, and that gap is
      // reported by the warning below and by the versions endpoint, not here.
      return { kind: "stored", received: imported.zoneCount, stored: imported.zoneCount, coverage: { endAt: new Date() } };
    });
    if (!result) return;

    if (!result.imported) {
      context.log(
        `On-demand zones: feed version ${result.feedVersion} is already imported (${result.zoneCount} zones); nothing to do.`,
      );
      return;
    }
    if (result.activated) {
      context.log(
        `On-demand zones: imported and activated feed version ${result.feedVersion} ` +
          `(${result.zoneCount} zones). No version was active beforehand.`,
      );
      return;
    }
    // Not an error: new geometry waits for a human. Warned rather than logged
    // so that a revision sitting unactivated for weeks is visible.
    context.warn(
      `On-demand zones: imported feed version ${result.feedVersion} (${result.zoneCount} zones) as INACTIVE ` +
        `version ${result.versionId}. The monitor continues on the currently active version until this one is ` +
        "activated via the on-demand-zone-versions endpoint.",
    );
  },
});
