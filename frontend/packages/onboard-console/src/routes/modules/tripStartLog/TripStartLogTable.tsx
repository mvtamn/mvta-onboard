import type { TripStartLogTrip } from "@mvta/shared";
import {
  bucketLabel,
  deltaLabel,
  gtfsClock,
  routeLabel,
  startBucket,
  timeLabel,
  type StartBucket,
} from "./tripStartLogState.js";

interface Props {
  trips: TripStartLogTrip[];
  selectedTripId: string | null;
  onSelect: (tripId: string) => void;
}

const PILL: Record<StartBucket, string> = {
  on_time: "pill-success",
  left_late: "pill-warning",
  late_over_5: "pill-danger",
  missed: "pill-danger",
  no_actual: "pill-muted",
  canceled: "pill-muted",
};

// The shell's reading of the rows, in the workbook's column order. Step 3 of
// the build replaces this with the reusable sortable Grid (sticky header,
// click-to-sort, keyboard rows); until then every view shows this list so
// selection and the inspector can be exercised end to end.
export function TripStartLogTable({ trips, selectedTripId, onSelect }: Props) {
  return (
    <div className="tsl-table-wrap">
      <table className="data tsl-table" aria-label="Dispatch log trips">
        <thead>
          <tr>
            <th scope="col">Verified</th>
            <th scope="col">Scheduled</th>
            <th scope="col">Actual</th>
            <th scope="col">Δ</th>
            <th scope="col">Status</th>
            <th scope="col">Block</th>
            <th scope="col">Route</th>
            <th scope="col">Origin stop</th>
            <th scope="col">Direction</th>
          </tr>
        </thead>
        <tbody>
          {trips.map((trip) => {
            const bucket = startBucket(trip);
            const selected = trip.trip_id === selectedTripId;
            return (
              <tr
                key={trip.trip_id}
                className={`${selected ? "selected" : ""}${trip.in_rotation ? "" : " dim"}`}
                aria-selected={selected}
                tabIndex={0}
                onClick={() => onSelect(trip.trip_id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(trip.trip_id);
                  }
                }}
              >
                <td>
                  {trip.verification ? (
                    <span className="tsl-initials" title={trip.verification.verified_by}>{trip.verification.verified_initials}</span>
                  ) : trip.in_rotation ? (
                    <span className="tsl-needs">Needs initials</span>
                  ) : (
                    <span className="td-dim">—</span>
                  )}
                </td>
                <td className="tsl-clock">{gtfsClock(trip.scheduled_start_seconds)}</td>
                <td className="tsl-clock td-dim">{timeLabel(trip.actual_start_at)}</td>
                <td className="tsl-clock">{deltaLabel(trip.start_delay_seconds)}</td>
                <td><span className={`pill-sm ${PILL[bucket]}`}>{bucketLabel(bucket)}</span></td>
                <td>{trip.block_id ?? "—"}</td>
                <td>{routeLabel(trip)}</td>
                <td>{trip.origin_stop_name ?? trip.origin_stop_id ?? "—"}</td>
                <td>{trip.direction_label ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
