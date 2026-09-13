// Whether a subscriber is in an alert's audience, by route and by zone.
//
// Lives here rather than inside dispatchMessageCreated so it can be tested:
// this package's test runner only picks up dist/src/lib/*.test.js, and
// routeMatches sat in the function file with no test at all.
//
// The two checks are ANDed, and each treats an alert that names nothing as
// system-wide. That composition is what makes a fixed-route alert and an
// on-demand zone alert both land correctly without either knowing about the
// other: a route alert names no zones, so every subscriber passes the zone
// check and only the route check filters; a zone alert names no routes, so the
// reverse.

export type Audience = string[] | "ALL" | null;

/**
 * A stored routes/zones column: a JSON array, the literal "ALL", or nothing.
 *
 * Anything that is not an array reads as null - "no preference" - which
 * matches every alert. Before this was extracted, JSON that parsed to an
 * object (`{}`) came back cast as an array, and the `.some()` in the matcher
 * threw. That throw was not per-subscriber: it escaped the delivery loop, so
 * one malformed row would have stopped an alert reaching every subscriber
 * after it and dead-lettered the message. Matching broadly on a row we cannot
 * read is the right failure - an alert a rider did not narrow away is a
 * nuisance, an alert nobody receives is the thing this system exists to prevent.
 */
export function parseAudience(value: string | null): Audience {
  if (!value) return null;
  if (value === "ALL") return "ALL";
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : null;
  } catch {
    return null;
  }
}

function audienceMatches(subscriber: Audience, alert: string[] | null | undefined): boolean {
  // No preference, or every one: the subscriber takes everything.
  if (subscriber === "ALL" || subscriber === null) return true;
  // An alert that names none is system-wide.
  if (!alert || alert.length === 0) return true;
  const named = new Set(alert);
  return subscriber.some((value) => named.has(value));
}

export function routeMatches(subscriberRoutes: Audience, alertRoutes: string[] | null | undefined): boolean {
  return audienceMatches(subscriberRoutes, alertRoutes);
}

/**
 * Zone matching. Closes CURRENT_STATE section 7.3: dispatch read an alert's
 * `zones_affected` into the event and never looked at it, so a zone-scoped
 * alert reached every subscriber regardless of the zone they chose.
 *
 * IDS ARE `external_location_id`, not `OnDemandOperationalZones.id`. The
 * monitor writes `resolved.zone.externalLocationId` into the column that
 * becomes `zones_affected` (onDemandSpareMonitorStore), and the rider
 * preference page offers the same values (subscriberPreferences.readOptions).
 * The UUID primary key lives in a DIFFERENT column that is also named
 * `zone_id`, on OnDemandRequestZoneSnapshots. Matching one space against the
 * other would never match, and would fail silently: a zone alert would reach
 * only the riders who had not narrowed at all.
 *
 * "Unzoned" is a real value in `zones_affected` - the monitor writes it when a
 * pickup falls outside every zone. It is never offered to riders, so it can
 * only ever reach subscribers on "ALL". That is deliberate: a rider who
 * narrowed to their own zone asked not to hear about places that are not it,
 * and a pickup nobody could place is not known to be in theirs.
 */
export function zoneMatches(subscriberZones: Audience, alertZones: string[] | null | undefined): boolean {
  return audienceMatches(subscriberZones, alertZones);
}
