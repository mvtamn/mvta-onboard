// Relief changes the Assessable Input before tiering (ADR 0012): an approved
// excusable-delay claim linked to an occurrence, or a documented outage of
// the system that observed it, removes that occurrence from the count with
// raw and excluded both kept. This file holds the two rules and the SQL that
// makes scoring and the report agree on them.

// Attachment G: written notice within 24 hours of the event, or relief is
// disqualified. A fact the Issuing Authority sees, not the decision itself.
export function isLateNotice(eventStartedAt: Date, noticeReceivedAt: Date): boolean {
  return noticeReceivedAt.getTime() - eventStartedAt.getTime() > 24 * 60 * 60 * 1000;
}

// Which system's outage excuses which observation follows the source the
// occurrence was raised from (ADR 0028 puts it in source_ref). Hand-entered
// occurrences have no system; no outage can excuse them.
const SOURCE_SYSTEMS: ReadonlyArray<{ prefix: string; system: "Avail_CAD_AVL" | "Spare" }> = [
  { prefix: "FixedRouteDepartures:avail_pullout:", system: "Avail_CAD_AVL" },
  { prefix: "MonitoredMissedTrips:gtfs:", system: "Avail_CAD_AVL" },
  { prefix: "MonitoredMissedTrips:spare:", system: "Spare" },
  { prefix: "OnDemandDepartures:spare_duties:", system: "Spare" },
];
export function outageSystemForSourceRef(sourceRef: string | null | undefined): "Avail_CAD_AVL" | "Spare" | null {
  if (!sourceRef) return null;
  return SOURCE_SYSTEMS.find(s => sourceRef.startsWith(s.prefix))?.system ?? null;
}

// Windows are stored in UTC; service dates are agency days (CONTEXT: the
// Assessment Period is determined in America/Chicago). An outage that began
// at 20:00 Central is the next UTC date and would otherwise miss its own day.
export const agencyDate = (utcColumn: string) => `CONVERT(date,${utcColumn} AT TIME ZONE 'UTC' AT TIME ZONE 'Central Standard Time')`;

// The same rule as a scalar subquery: the system of the first matching
// window covering the occurrence's service date, or NULL. `alias` is the
// ComplianceOccurrences alias in the enclosing query.
export function outageExclusionSql(alias: string): string {
  const o = alias;
  const system = `CASE ${SOURCE_SYSTEMS.map(s => `WHEN ${o}.source_ref LIKE '${s.prefix}%' THEN '${s.system}'`).join(" ")} END`;
  return `(SELECT TOP 1 w.system FROM SystemOutageWindows w WHERE w.system=${system} AND ${agencyDate("w.started_at")}<=CONVERT(date,${o}.service_date,112) AND (w.ended_at IS NULL OR ${agencyDate("w.ended_at")}>=CONVERT(date,${o}.service_date,112)) ORDER BY w.started_at)`;
}
