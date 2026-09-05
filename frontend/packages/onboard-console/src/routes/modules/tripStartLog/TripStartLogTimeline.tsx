import type { TripStartLogTrip } from "@mvta/shared";
import {
  bucketLabel,
  deltaLabel,
  gtfsClock,
  hourLabel,
  hourMarks,
  routeLabel,
  startBucket,
  timeLabel,
  timelineLanes,
  timelineRange,
  timelineX,
  type StartBucket,
} from "./tripStartLogState.js";

interface Props {
  trips: TripStartLogTrip[];
  /** Null when the service date is not today; the marker is then not drawn. */
  now: Date | null;
  selectedTripId: string | null;
  onSelect: (tripId: string) => void;
}

export const TIMELINE_PX_PER_HOUR = 150;
const LABEL_WIDTH = 96;

const CHIP: Record<StartBucket, string> = {
  on_time: "success",
  left_late: "warning",
  late_over_5: "danger",
  missed: "danger",
  no_actual: "muted",
  canceled: "muted",
};

// The thing neither table can show (spec §4.3): how lateness moves along a
// block. One lane per block, time left to right. A hairline tick marks the
// scheduled minute and the chip sits at the actual start, so lateness reads
// as displacement, with a slip bar spanning the gap, rather than as a colour
// to decode. Lanes come from the filtered rows, so narrowing to a route
// collapses the picture to the blocks that serve it.
export function TripStartLogTimeline({ trips, now, selectedTripId, onSelect }: Props) {
  const range = timelineRange(trips);
  if (!range) return null;
  const lanes = timelineLanes(trips);
  const width = timelineX(range.end, range, TIMELINE_PX_PER_HOUR);
  const nowMs = now?.getTime() ?? null;
  const nowX = nowMs !== null && nowMs >= range.start && nowMs <= range.end ? timelineX(nowMs, range, TIMELINE_PX_PER_HOUR) : null;

  return (
    <div className="tsl-timeline" role="figure" aria-label="Trip starts by block">
      <div className="tsl-timeline-inner" style={{ width: LABEL_WIDTH + width }}>
        <div className="tsl-timeline-axis" style={{ marginLeft: LABEL_WIDTH, width }}>
          {hourMarks(range).map((mark) => (
            <span key={mark} className="tsl-hour" style={{ left: timelineX(mark, range, TIMELINE_PX_PER_HOUR) }}>
              {hourLabel(mark)}
            </span>
          ))}
        </div>
        <ol className="tsl-lanes" aria-label="Blocks">
          {lanes.map((lane) => (
            <li key={lane.block} className="tsl-lane">
              <span className="tsl-lane-label">Block {lane.block}</span>
              <div className="tsl-track" style={{ width }}>
                {hourMarks(range).map((mark) => (
                  <span key={mark} className="tsl-gridline" style={{ left: timelineX(mark, range, TIMELINE_PX_PER_HOUR) }} aria-hidden="true" />
                ))}
                {lane.trips.map((trip) => {
                  const sched = new Date(trip.scheduled_start_at).getTime();
                  const actual = trip.actual_start_at ? new Date(trip.actual_start_at).getTime() : null;
                  const schedX = timelineX(sched, range, TIMELINE_PX_PER_HOUR);
                  const chipX = timelineX(actual ?? sched, range, TIMELINE_PX_PER_HOUR);
                  const bucket = startBucket(trip);
                  const selected = trip.trip_id === selectedTripId;
                  const label =
                    `Route ${routeLabel(trip)}, scheduled ${gtfsClock(trip.scheduled_start_seconds)}, ` +
                    (actual ? `actual ${timeLabel(trip.actual_start_at)}, ${deltaLabel(trip.start_delay_seconds)}, ` : "no actual, ") +
                    bucketLabel(bucket);
                  return (
                    <span key={trip.trip_id} className="tsl-trip">
                      <span className="tsl-tick" style={{ left: schedX }} aria-hidden="true" />
                      {actual !== null && Math.abs(chipX - schedX) >= 1 ? (
                        <span
                          className={`tsl-slip ${CHIP[bucket]}`}
                          style={{ left: Math.min(schedX, chipX), width: Math.abs(chipX - schedX) }}
                          aria-hidden="true"
                        />
                      ) : null}
                      <button
                        type="button"
                        className={`tsl-chip ${CHIP[bucket]}${actual === null ? " hollow" : ""}${selected ? " selected" : ""}${trip.in_rotation ? " rotation" : ""}`}
                        style={{ left: chipX }}
                        aria-label={label}
                        aria-pressed={selected}
                        title={label}
                        onClick={() => onSelect(trip.trip_id)}
                      >
                        {routeLabel(trip)}
                      </button>
                    </span>
                  );
                })}
              </div>
            </li>
          ))}
        </ol>
        {nowX !== null ? (
          <div className="tsl-now" style={{ left: LABEL_WIDTH + nowX }} aria-label="Now">
            <span>now</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
