// Shared fixture for the schedule review tests. Stops laid out along a
// meridian: 0.01 degrees of latitude is about 1.1 km, so A-B-C are ordinary
// local stops and D is about 24 km (15 miles) on.
import type { PredictionRiskFeed } from "./feedModel";

export const STOPS =
  "stop_id,stop_name,stop_lat,stop_lon\n" +
  "A,A,44.70,-93.20\nB,B,44.71,-93.20\nC,C,44.72,-93.20\nD,D,44.92,-93.20\n";

export const ST_HEADER = "trip_id,arrival_time,departure_time,stop_id,stop_sequence,timepoint\n";

export function feed(over: Partial<PredictionRiskFeed>): PredictionRiskFeed {
  return {
    routesCsv: "route_id,route_short_name\nR1,401\nR2,402\n",
    stopsCsv: STOPS,
    tripsCsv: "route_id,service_id,trip_id,direction_id,block_id\nR1,S,T1,0,B1\n",
    stopTimesCsv: ST_HEADER + "T1,6:00:00,6:00:00,A,1,1\nT1,6:03:00,6:03:00,B,2,0\nT1,6:06:00,6:06:00,C,3,1\n",
    feedInfoCsv: null,
    ...over,
  };
}

/** HH:MM:SS on the GTFS clock from a minute count. */
export function at(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, "0")}:00`;
}
