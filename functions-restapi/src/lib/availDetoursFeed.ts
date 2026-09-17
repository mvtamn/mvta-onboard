// Avail360 Detours feed (GET /Detours/v1/{Property}) - Part B4 of
// detour-and-event-module-implementation-plan.md, per detour-module-build-
// brief.md's own review of the OpenAPI spec. Unlike every other Avail feed
// in this project, this endpoint takes no date parameters at all - it's a
// single flat GET returning every detour currently known to Avail.
//
// A single real-world detour comes back as MULTIPLE rows sharing one
// DetourID - one row per direction (the brief's sample shows Inbound and
// Outbound as separate rows for DetourID 30). groupDetourReports below
// collapses that into one Detours-shaped record with N segments, matching
// the DetourSegments concept already in migration-017.
//
// Deliberately NOT persisted from this feed (per the brief's own MVP
// scope-cut): IsActive (informational only - status is always computed by
// detourStatus.ts, never taken from Avail), Cause/Effect (brief: "not
// required for MVP"), and Avail's own CreatedBy/On UpdatedBy/On (brief:
// "tag it clearly as Avail-sourced, don't merge with your own CreatedBy" -
// simplest way to honor that is to not store them as this project's
// created_by/updated_by at all; revisit only if a real need shows up).
//
// ENVELOPE KEY CONFIRMED live 2026-08-05: originally guessed as
// result.Detours (the Operation-ID-matches-array-key pattern observed for
// AVL Reports/Pullout/OTP Monthly/Missed Trips), which was wrong - the real
// key is lowercase result.detours, as the endpoint definition in
// availClient.ts records. The brief's open question #4 flagged this same-key-name risk, and
// it was justified; the sibling DetourStops feed is still unverified.
export interface AvailDetourReport {
  DetourID: number;
  DetourName: string | null;
  RouteID: number | string | null;
  Direction: string | null;
  TurnByTurnMessage: string | null;
  StartDate: string | null;
  EndDate: string | null;
  IsActive?: boolean;
  Cause?: string | null;
  Effect?: string | null;
}

export interface MappedDetourSegment {
  routes: string;
  directions: string | null;
}

export interface MappedDetour {
  external_detour_id: string;
  closure: string;
  start_date: string | null; // YYYY-MM-DD
  end_date: string | null;
  segments: MappedDetourSegment[];
}

function toIsoDate(value: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function segmentLabel(report: AvailDetourReport): string {
  const parts = [report.RouteID != null ? String(report.RouteID) : null, report.Direction ?? null].filter(
    (p): p is string => Boolean(p),
  );
  return parts.length > 0 ? parts.join(" ") : "Unknown route";
}

// Groups the flat list of per-direction rows by DetourID into one Detours
// row + N DetourSegments per group. Guard-clause: a row with no usable
// DetourID/DetourName is dropped rather than throwing - one malformed row
// shouldn't abort the whole sync run (same convention as
// mapMissedTripReport/mapAvlReport).
export function groupDetourReports(reports: AvailDetourReport[]): MappedDetour[] {
  const groups = new Map<string, AvailDetourReport[]>();
  for (const report of reports) {
    if (typeof report.DetourID !== "number") continue;
    const key = String(report.DetourID);
    const existing = groups.get(key);
    if (existing) {
      existing.push(report);
    } else {
      groups.set(key, [report]);
    }
  }

  const mapped: MappedDetour[] = [];
  for (const [externalId, rows] of groups) {
    const first = rows[0];
    const closure = first.DetourName?.trim() || `Avail detour ${externalId}`;
    mapped.push({
      external_detour_id: externalId,
      closure,
      start_date: toIsoDate(first.StartDate),
      end_date: toIsoDate(first.EndDate),
      segments: rows.map((r) => ({
        routes: segmentLabel(r),
        directions: r.TurnByTurnMessage?.trim() || null,
      })),
    });
  }
  return mapped;
}
