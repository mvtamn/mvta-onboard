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
// KNOWN UNCONFIRMED ASSUMPTION (flagging prominently, same as every other
// Avail feed built this session): the envelope's array key is guessed as
// result.Detours, following the Operation-ID-matches-array-key pattern
// observed for AVL Reports/Pullout/OTP Monthly/Missed Trips. The brief
// itself (open question #4) flags this same-key-name risk for the sibling
// DetourStops feed. Verify against a real response before relying on this.
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

export interface AvailDetoursEnvelope {
  errors: string[];
  result: {
    Detours: AvailDetourReport[];
  };
  success: boolean;
}

// baseUrl is the full agency-level URL, e.g.
// "https://avail360-api.myavail.cloud/Detours/v1/MVTA" - no date suffix.
export async function fetchDetours(baseUrl: string, apiKey: string): Promise<AvailDetourReport[]> {
  const res = await fetch(baseUrl, {
    headers: { "Ocp-Apim-Subscription-Key": apiKey },
  });
  if (!res.ok) {
    throw new Error(`Avail Detours request failed: ${res.status}`);
  }
  const payload = (await res.json()) as AvailDetoursEnvelope;
  if (!payload.success) {
    throw new Error(`Avail Detours API returned success=false: ${payload.errors?.join(", ") || "no error detail"}`);
  }
  const rows = payload.result?.Detours;
  if (rows !== undefined) return rows;

  // The guessed envelope key wasn't found. If result carries any OTHER key,
  // that's almost certainly the real array key - surface the actual key
  // names (never the data itself) rather than silently syncing zero
  // detours forever. Confirmed live: the sync runs cleanly every 15 minutes
  // but has reported "0 detours seen" on every run so far - this is the
  // same class of issue otpMonthlyFeed.ts hit with its own guessed key.
  const actualKeys = payload.result ? Object.keys(payload.result) : [];
  if (actualKeys.length > 0) {
    throw new Error(
      `Avail Detours response has no "Detours" key under result - found [${actualKeys.join(", ")}] instead. Update the guessed key in availDetoursFeed.ts.`,
    );
  }
  return [];
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
