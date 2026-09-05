import type { TripStartLogTrip, TripStartVerificationAction } from "@mvta/shared";
import {
  DISPOSITION_LABEL,
  UP_NEXT_HORIZON_MINUTES,
  gtfsClock,
  needsDisposition,
  routeLabel,
  serviceDateLabel,
  upNext,
  type DispositionReason,
} from "./tripStartLogState.js";

interface Props {
  trips: TripStartLogTrip[];
  serviceDate: string;
  now: Date;
  /** Whether the service date is today; "up next" has no meaning otherwise. */
  isToday: boolean;
  selectedTripId: string | null;
  onSelect: (tripId: string) => void;
  canVerify: boolean;
  onVerify: (tripId: string, action: TripStartVerificationAction) => void;
  onDisposition: (tripId: string) => void;
}

const NEEDS_ROLE = "Requires the Trip Start Verifier role";

const SEVERITY_PILL: Record<DispositionReason, string> = {
  missed: "pill-danger",
  late_over_5: "pill-danger",
  no_actual_past_due: "pill-warning",
};

// The live monitoring the desk actually does (spec §4.3): what is about to
// start, with the rotation trips flagged, and what has already gone wrong and
// needs a person to decide something. Reads the same filtered rows as the
// other views; verify and disposition actions are step 6 and sit here
// disabled so the layout is settled before they work.
export function TripStartLogWatch({ trips, serviceDate, now, isToday, selectedTripId, onSelect, canVerify, onVerify, onDisposition }: Props) {
  const upcoming = isToday ? upNext(trips, now) : [];
  const dispositions = needsDisposition(trips, now);
  const rotationDue = upcoming.filter((t) => t.in_rotation).length;

  return (
    <div className="tsl-watch">
      <section className="tsl-watch-section" aria-labelledby="tsl-up-next">
        <div className="tsl-watch-head">
          <h3 id="tsl-up-next">Up next</h3>
          <span>
            {isToday
              ? `Next ${UP_NEXT_HORIZON_MINUTES} minutes · ${upcoming.length} due · ${rotationDue} on the rotation`
              : "Follows the live clock"}
          </span>
        </div>
        {!isToday ? (
          <div className="risk-empty-state">
            <strong>Not the live day</strong>
            <span>{serviceDateLabel(serviceDate)} is not today, so nothing is due. Pick today's date to watch the queue.</span>
          </div>
        ) : upcoming.length === 0 ? (
          <div className="risk-empty-state">
            <strong>Nothing due in the next {UP_NEXT_HORIZON_MINUTES} minutes</strong>
            <span>Trips that have already started leave the queue; the Grid holds the whole day.</span>
          </div>
        ) : (
          <ul className="tsl-watch-list" aria-label="Up next">
            {upcoming.map((trip) => (
              <li
                key={trip.trip_id}
                className={`tsl-watch-item${trip.in_rotation ? " rotation" : ""}${trip.trip_id === selectedTripId ? " selected" : ""}`}
                aria-selected={trip.trip_id === selectedTripId}
              >
                <button type="button" className="tsl-watch-main" onClick={() => onSelect(trip.trip_id)}>
                  <span className="tsl-clock">{gtfsClock(trip.scheduled_start_seconds)}</span>
                  <span className="tsl-watch-route">Route {routeLabel(trip)} · block {trip.block_id ?? "—"}</span>
                  <span className="tsl-watch-origin">{trip.origin_stop_name ?? trip.origin_stop_id ?? "—"}{trip.direction_label ? ` · ${trip.direction_label}` : ""}</span>
                </button>
                {trip.in_rotation ? (
                  <span className="tsl-watch-actions">
                    <span className="pill-sm pill-accent">Rotation</span>
                    {trip.verification ? (
                      <span className="tsl-initials" title={trip.verification.verified_by}>{trip.verification.verified_initials}</span>
                    ) : (
                      <>
                        <button type="button" className="btn-sm" disabled={!canVerify} title={canVerify ? "Mark observed on time" : NEEDS_ROLE} onClick={() => onVerify(trip.trip_id, "observed_on_time")}>On time</button>
                        <button type="button" className="btn-sm" disabled={!canVerify} title={canVerify ? "Mark observed left late" : NEEDS_ROLE} onClick={() => onVerify(trip.trip_id, "observed_left_late")}>Left late</button>
                      </>
                    )}
                  </span>
                ) : (
                  <span className="tsl-watch-actions"><span className="pill-sm pill-muted">Tracked</span></span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="tsl-watch-section" aria-labelledby="tsl-needs-disposition">
        <div className="tsl-watch-head">
          <h3 id="tsl-needs-disposition">Needs disposition</h3>
          <span>{dispositions.length} by severity</span>
        </div>
        {dispositions.length === 0 ? (
          <div className="risk-empty-state">
            <strong>Nothing needs a disposition</strong>
            <span>No trip in view is missed, late beyond five minutes, or past due without evidence.</span>
          </div>
        ) : (
          <ul className="tsl-watch-list" aria-label="Needs disposition">
            {dispositions.map(({ trip, reason, minutesPastDue }) => (
              <li
                key={trip.trip_id}
                className={`tsl-watch-item${trip.trip_id === selectedTripId ? " selected" : ""}`}
                aria-selected={trip.trip_id === selectedTripId}
              >
                <button type="button" className="tsl-watch-main" onClick={() => onSelect(trip.trip_id)}>
                  <span className={`pill-sm ${SEVERITY_PILL[reason]}`}>
                    {DISPOSITION_LABEL[reason]}
                    {reason === "no_actual_past_due" ? ` · ${minutesPastDue} min past due` : reason === "late_over_5" && trip.start_delay_seconds !== null ? ` · +${Math.round(trip.start_delay_seconds / 60)} min` : ""}
                  </span>
                  <span className="tsl-clock">{gtfsClock(trip.scheduled_start_seconds)}</span>
                  <span className="tsl-watch-route">Route {routeLabel(trip)} · block {trip.block_id ?? "—"}</span>
                </button>
                <span className="tsl-watch-actions">
                  {trip.verification ? (
                    <span className="tsl-initials" title={trip.verification.verified_by}>{trip.verification.verified_initials}</span>
                  ) : (
                    <button type="button" className="btn-sm" disabled={!canVerify} title={canVerify ? "Leave the cell blank and record the procedure followed" : NEEDS_ROLE} onClick={() => onDisposition(trip.trip_id)}>Record disposition</button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
