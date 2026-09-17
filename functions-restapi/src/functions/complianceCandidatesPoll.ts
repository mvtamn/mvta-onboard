import { app, type InvocationContext } from "@azure/functions";
import { getPool } from "../lib/db";
import { loadKpiTrust } from "../lib/kpiTrustStore";
import {
  departureSourceAllowed,
  garageDepartureVarianceSeconds,
  raiseCandidates,
  settledServiceDateExclusive,
} from "../lib/occurrenceIntake";

// Copies eligible source observations into the governed assessment queue once
// a day. Which observations are eligible, which contractor each belongs to and
// whether it may be written are the occurrence intake module's rules
// (lib/occurrenceIntake); this timer decides only which sources are trusted
// tonight. Existing feed-specific review remains authoritative: nothing here
// confirms attribution or creates a penalty.
app.timer("complianceCandidatesPoll", {
  schedule: "0 20 6 * * *",
  handler: async (_timer, context: InvocationContext) => {
    try {
      const pool = await getPool();
      const trust = await loadKpiTrust(pool);
      const tables = (await pool.request().query<{ missed: number; fixed: number; on_demand: number }>(`
        SELECT CASE WHEN OBJECT_ID('dbo.MonitoredMissedTrips','U') IS NULL THEN 0 ELSE 1 END missed,
          CASE WHEN OBJECT_ID('dbo.FixedRouteDepartures','U') IS NULL THEN 0 ELSE 1 END fixed,
          CASE WHEN OBJECT_ID('dbo.OnDemandDepartures','U') IS NULL THEN 0 ELSE 1 END on_demand
      `)).recordset[0];
      const allowFixedMissedTrips = trust.fixed_route_missed_trips.state === "current";
      const allowSpareMissedTrips = trust.spare_missed_trips.state === "current";
      const allowFixedRouteDepartures = departureSourceAllowed(trust.fixed_route_departures?.state);
      const allowOnDemandDepartures = departureSourceAllowed(trust.on_demand_departures?.state);
      // The on-demand table arrives with migration 096b; until it exists the
      // Spare half is simply absent, which ADR 0028 says is the right reading
      // of a departure with no source for its service type.
      if (!tables.on_demand) context.warn("OnDemandDepartures is missing (migration 096b); on-demand garage departures raise no candidates.");
      if (!allowFixedRouteDepartures) context.warn(`Fixed-route departures feed is ${trust.fixed_route_departures?.state ?? "unknown"}; no fixed-route garage-departure candidates this run.`);
      if (tables.on_demand && !allowOnDemandDepartures) context.warn(`On-demand departures feed is ${trust.on_demand_departures?.state ?? "unknown"}; no on-demand garage-departure candidates this run.`);

      const result = await raiseCandidates(pool, {
        gates: {
          missed_trips: tables.missed === 1 && (allowFixedMissedTrips || allowSpareMissedTrips),
          fixed_route_departures: tables.fixed === 1 && allowFixedRouteDepartures,
          on_demand_departures: tables.on_demand === 1 && allowOnDemandDepartures,
        },
        allowFixedMissedTrips,
        allowSpareMissedTrips,
        varianceSeconds: garageDepartureVarianceSeconds(),
        settledBefore: settledServiceDateExclusive(),
      });
      for (const [source, report] of Object.entries(result)) {
        if ("failed" in report) context.error(`Compliance candidates (${source}) failed`, report.failed);
        else if ("raised" in report) context.log(`Compliance candidates (${source}): ${report.raised} raised; not written: ${report.unassigned} unassigned, ${report.not_scored} standard not scored, ${report.period_closed} period closed.`);
      }
    } catch (error) { context.error("complianceCandidatesPoll failed", error); }
  },
});
