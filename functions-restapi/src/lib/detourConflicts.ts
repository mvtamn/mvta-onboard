// Conflicts between authoritative Detours: another non-closed Detour that
// shares a route number or place word inside an overlapping operating
// window - the same signal intake uses for likely duplicates, applied
// Detour to Detour. Proceeding anyway requires an explicit, reasoned
// override (migration 090), which covers the conflicts known when it was
// recorded; a conflict that appears afterwards reopens the question. Loading
// and deciding live in the Detour workflow module (lib/detourWorkflow).
import type { ConnectionPool, Transaction } from "mssql";
import { findLikelyDuplicates, type DuplicateCandidate, type LikelyDuplicate } from "./detourDuplicates";
import { toDateOnly } from "./detourStatus";
import { parseGeometryJson } from "./geoNearby";
import { loadStopIndex, requestOn, stopIdsForRecord, stopNameLookup, type StopIndexEntry } from "./detourStops";

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

export function detourConflicts(subject: DetourConflictScope, all: DetourConflictScope[], stopName?: (id: string) => string): LikelyDuplicate[] {
  return findLikelyDuplicates(subject, all.filter((c) => c.id !== subject.id), stopName);
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
  service_area: string | null; start_date: Date | null; end_date: Date | null; lifecycle_state: string; segment_routes: string | null;
  geometry_json: string | null;
  affected_stops_and_stations: string | null;
}

export interface DetourConflictContext {
  // Every Detour that can conflict: not deleted, not closed.
  scopes: DetourConflictScope[];
  stopName: (id: string) => string;
}

// One scope and stop-index load, from a pool or from inside the caller's
// transaction (the Detour workflow module reads it under its row lock).
export async function loadDetourConflictContext(db: ConnectionPool | Transaction): Promise<DetourConflictContext> {
  const rows = await requestOn(db).query<ScopeRow>(`
    SELECT d.id, d.internal_number, d.number, d.closure, d.location, d.service_area,
           d.start_date, d.end_date, d.lifecycle_state, d.geometry_json, d.affected_stops_and_stations,
           (SELECT STRING_AGG(s.routes, '; ') FROM DetourSegments s WHERE s.detour_id = d.id) AS segment_routes
    FROM Detours d
    WHERE d.is_deleted = 0 AND d.lifecycle_state <> 'closed'`);
  const stopIndex = await loadStopIndex(db);
  const scopes = rows.recordset.map((d) => {
    const geometry = parseGeometryJson(d.geometry_json);
    return {
      kind: "detour" as const, id: d.id, label: d.internal_number || d.number || d.closure, status: d.lifecycle_state,
      place_text: [d.closure, d.location].filter(Boolean).join(" "),
      route_texts: [d.segment_routes, d.service_area].filter((v): v is string => Boolean(v)),
      start_date: toDateOnly(d.start_date), end_date: toDateOnly(d.end_date),
      geometry,
      stop_ids: stopIdsForRecord(stopIndex, geometry, d.affected_stops_and_stations),
    };
  });
  return { scopes, stopName: stopNameLookup(stopIndex) };
}
export type { StopIndexEntry };
