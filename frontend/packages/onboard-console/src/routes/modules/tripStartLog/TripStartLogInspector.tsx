import type { TripStartLogTrip } from "@mvta/shared";
import {
  bucketLabel,
  dayLabel,
  deltaLabel,
  gtfsClock,
  observationLabel,
  routeLabel,
  serviceDateLabel,
  startBucket,
  timeLabel,
} from "./tripStartLogState.js";

interface Props {
  trip: TripStartLogTrip | null;
  /** Lowercase weekday of the service date, for "on today's list". */
  serviceDow: string | null;
}

// The persistent panel below whichever view is open (spec §4.3). Selecting in
// any view lands here, so the views never need detail panels of their own.
export function TripStartLogInspector({ trip, serviceDow }: Props) {
  if (!trip) {
    return (
      <aside className="tsl-inspector" aria-label="Trip details">
        <p className="tsl-inspector-empty">Select a trip to see its scheduled and actual start, origin, rotation day, and verification.</p>
      </aside>
    );
  }
  const bucket = startBucket(trip);
  const onList = trip.in_rotation;
  return (
    <aside className="tsl-inspector" aria-label="Trip details">
      <div className="tsl-inspector-head">
        <h3>
          Route {routeLabel(trip)} · block {trip.block_id ?? "—"} · {gtfsClock(trip.scheduled_start_seconds)}
        </h3>
        <span className="tsl-inspector-sub">{serviceDateLabel(trip.service_date)} · trip {trip.trip_id}</span>
      </div>
      <dl>
        <div><dt>Scheduled</dt><dd>{gtfsClock(trip.scheduled_start_seconds)} ({timeLabel(trip.scheduled_start_at)})</dd></div>
        <div><dt>Actual</dt><dd>{timeLabel(trip.actual_start_at)}{trip.actual_start_source ? <span className="td-dim"> · {trip.actual_start_source.replace("_", " ")}</span> : null}</dd></div>
        <div><dt>Delta</dt><dd>{deltaLabel(trip.start_delay_seconds)}</dd></div>
        <div><dt>Status</dt><dd>{bucketLabel(bucket)}</dd></div>
        <div><dt>Origin stop</dt><dd>{trip.origin_stop_name ?? trip.origin_stop_id ?? "—"}</dd></div>
        <div><dt>Direction</dt><dd>{trip.direction_label ?? "—"}</dd></div>
        <div>
          <dt>Rotation day</dt>
          <dd>
            {dayLabel(trip.rotation_day)}
            {onList ? " · on today's list" : serviceDow && trip.rotation_day ? " · not today" : ""}
          </dd>
        </div>
        <div>
          <dt>Verification</dt>
          <dd>
            {trip.verification ? (
              <>
                {observationLabel(trip.verification.observation)} · {trip.verification.verified_initials} · {timeLabel(trip.verification.verified_at)}
                {trip.verification.note ? <span className="td-dim"> · {trip.verification.note}</span> : null}
              </>
            ) : onList ? (
              <span className="tsl-needs">Needs initials</span>
            ) : (
              "Not on today's list"
            )}
          </dd>
        </div>
      </dl>
      {/* The affordance is here now so the three views inherit it; the
          endpoint, role check and audit trail are step 6 of the build. */}
      <div className="tsl-inspector-actions" aria-label="Verify actions">
        <button type="button" className="btn-sm" disabled title="Verification recording is not available yet">Observed on time</button>
        <button type="button" className="btn-sm" disabled title="Verification recording is not available yet">Observed left late</button>
        <small>Recording an observation arrives in a later step; the auto-computed status is shown beside it, never instead of it.</small>
      </div>
    </aside>
  );
}
