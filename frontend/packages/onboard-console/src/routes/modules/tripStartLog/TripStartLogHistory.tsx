import { useEffect, useState } from "react";
import { type TripStartVerificationEvent } from "@mvta/shared";
import { api } from "../../../config.js";
import { observationLabel, verifiedAtLabel } from "./tripStartLogState.js";

/**
 * Every change ever made to the selected trip's Verified cell. The cell says
 * where the entry stands now; this says how it got there, so a correction
 * never erases the entry it corrected. Read-only for everyone who can read
 * the log: the desk records, MVTA reviews.
 *
 * Loaded per trip rather than per day - a day is ~600 rows and only the trip
 * in the inspector is being asked about - and re-read whenever an entry is
 * recorded, so the desk sees its own change land.
 */
export function useVerificationHistory(serviceDate: string | null, tripId: string | null, reloadToken: number) {
  const [events, setEvents] = useState<TripStartVerificationEvent[]>([]);

  useEffect(() => {
    if (!serviceDate || !tripId) {
      setEvents([]);
      return;
    }
    let current = true;
    api
      .getTripStartVerificationHistory(serviceDate, tripId)
      .then((response) => {
        // A slower answer for a trip the desk has already left must not
        // land under the trip now selected.
        if (current) setEvents(response.events);
      })
      // History is context, never the reason a trip cannot be read: a failure
      // leaves the section absent rather than putting an error over the log.
      .catch(() => {
        if (current) setEvents([]);
      });
    return () => {
      current = false;
    };
  }, [serviceDate, tripId, reloadToken]);

  return events;
}

/** "Blank → Observed on time", "Observed on time → cleared". */
function changeLabel(event: TripStartVerificationEvent): string {
  const from = event.previous_observation ? observationLabel(event.previous_observation) : "Blank";
  const to = event.observation ? observationLabel(event.observation) : "cleared";
  return `${from} → ${to}`;
}

export function TripStartLogHistory({ events, serviceDate }: { events: TripStartVerificationEvent[]; serviceDate: string }) {
  if (events.length === 0) return null;
  return (
    <div className="tsl-history">
      <h4>History</h4>
      <ul aria-label="Verification history">
        {events.map((event) => (
          <li key={event.id}>
            <span className="tsl-history-when">{verifiedAtLabel(event.recorded_at, serviceDate)}</span>
            <span className="tsl-initials" title={event.recorded_by}>{event.recorded_initials}</span>
            <span className="tsl-history-change">{changeLabel(event)}</span>
            {event.note ? <span className="td-dim">{event.note}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
