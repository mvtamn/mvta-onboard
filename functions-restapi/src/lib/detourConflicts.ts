// Conflicts between authoritative Detours: another non-closed Detour that
// shares a route number or place word inside an overlapping operating
// window - the same signal intake uses for likely duplicates, applied
// Detour to Detour. Proceeding anyway requires an explicit, reasoned
// override (migration 090), which covers the conflicts known when it was
// recorded; a conflict that appears afterwards reopens the question.
import type { ConnectionPool } from "mssql";
import { findLikelyDuplicates, type DuplicateCandidate, type LikelyDuplicate } from "./detourDuplicates";
import { toDateOnly } from "./detourStatus";
import { parseGeometryJson } from "./geoNearby";

export type DetourConflictStatus = "none" | "unresolved" | "overridden";

export interface DetourConflictOverride {
  reason: string | null;
  by: string | null;
  at: Date | string | null;
  // Detour ids the override covered, as stored.
  ids: string[];
}

export interface DetourConflictScope extends DuplicateCandidate { kind: "detour" }

export function parseOverrideIds(value: string | null | undefined): string[] {
  if (!value) return [];
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : []; }
  catch { return []; }
}

export function detourConflicts(subject: DetourConflictScope, all: DetourConflictScope[]): LikelyDuplicate[] {
  return findLikelyDuplicates(subject, all.filter((c) => c.id !== subject.id));
}

// "overridden" only while every current conflict was known to the override;
// a new one flips the Detour back to "unresolved" without erasing the
// recorded reason.
export function conflictStatus(conflicts: LikelyDuplicate[], override: DetourConflictOverride | null): DetourConflictStatus {
  if (conflicts.length === 0) return "none";
  if (!override?.reason) return "unresolved";
  const covered = new Set(override.ids);
  return conflicts.every((c) => covered.has(c.id)) ? "overridden" : "unresolved";
}

interface ScopeRow {
  id: string; internal_number: string | null; number: string | null; closure: string; location: string | null;
  service_area: string | null; start_date: Date | null; end_date: Date | null; lifecycle_state: string | null; segment_routes: string | null;
  geometry_json: string | null;
}

// Every Detour that can conflict: not deleted, not closed. Column presence
// follows the migrations the same way detoursList does.
export async function loadDetourConflictScopes(pool: ConnectionPool): Promise<DetourConflictScope[]> {
  const schema = await pool.request().query<{ workflow: number; intake: number; location: number; geometry: number }>(`
    SELECT CASE WHEN COL_LENGTH('dbo.Detours', 'lifecycle_state') IS NULL THEN 0 ELSE 1 END AS workflow,
           CASE WHEN COL_LENGTH('dbo.Detours', 'service_area') IS NULL THEN 0 ELSE 1 END AS intake,
           CASE WHEN COL_LENGTH('dbo.Detours', 'location') IS NULL THEN 0 ELSE 1 END AS location,
           CASE WHEN COL_LENGTH('dbo.Detours', 'geometry_json') IS NULL THEN 0 ELSE 1 END AS geometry`);
  const f = schema.recordset[0];
  const rows = await pool.request().query<ScopeRow>(`
    SELECT d.id, ${f?.workflow ? "d.internal_number" : "NULL AS internal_number"}, d.number, d.closure,
           ${f?.location ? "d.location" : "NULL AS location"}, ${f?.intake ? "d.service_area" : "NULL AS service_area"},
           d.start_date, d.end_date, ${f?.workflow ? "d.lifecycle_state" : "NULL AS lifecycle_state"},
           ${f?.geometry ? "d.geometry_json" : "NULL AS geometry_json"},
           (SELECT STRING_AGG(s.routes, '; ') FROM DetourSegments s WHERE s.detour_id = d.id) AS segment_routes
    FROM Detours d
    WHERE d.is_deleted = 0 ${f?.workflow ? "AND (d.lifecycle_state IS NULL OR d.lifecycle_state <> 'closed')" : ""}`);
  return rows.recordset.map((d) => ({
    kind: "detour" as const, id: d.id, label: d.internal_number || d.number || d.closure, status: d.lifecycle_state ?? "recorded",
    place_text: [d.closure, d.location].filter(Boolean).join(" "),
    route_texts: [d.segment_routes, d.service_area].filter((v): v is string => Boolean(v)),
    start_date: toDateOnly(d.start_date), end_date: toDateOnly(d.end_date),
    geometry: parseGeometryJson(d.geometry_json),
  }));
}
