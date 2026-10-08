import type { TripStartLogTrip } from "@mvta/shared";
import { verifiedAtLabel } from "./tripStartLogState.js";

/**
 * A recorded entry as the workbook's Verified cell shows it: the initials of
 * whoever recorded it, over the time they did. The time answers the question
 * the initials alone leave open - when the desk actually watched this trip -
 * and it is the current entry's time, so a correction re-times the cell. The
 * full account name stays on hover, as it always has.
 */
export function VerifiedInitials({ trip }: { trip: TripStartLogTrip }) {
  if (!trip.verification) return null;
  return (
    <span className="tsl-verified">
      <span className="tsl-initials" title={trip.verification.verified_by}>{trip.verification.verified_initials}</span>
      <span className="tsl-verified-at">{verifiedAtLabel(trip.verification.verified_at, trip.service_date)}</span>
    </span>
  );
}
