// GET /detours - list detour/closure records with a computed status
// (Active/Upcoming/Monitor/Recently finished/Expired - see detourStatus.ts,
// the single shared definition). Any staff role can read, including
// OCC.Viewer (read-only per the owner's decision - Detours is a day-to-day
// operational view, not compliance-audit or admin-only), plus OCC.Compliance
// (which needs detour history for reporting but no edit rights) and the
// dedicated OCC.Detour role - see DETOUR_READ_ROLES in auth.ts. Accepts an
// optional ?status= filter using the same status keys DETOUR_STATUS_LABELS
// exposes; an unrecognized value is ignored rather than erroring, so a
// stale/typo'd query param degrades to "show everything" instead of 400ing.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { requireRole, DETOUR_READ_ROLES } from "../lib/auth";
import { computeDetourStatus, type DetourStatus } from "../lib/detourStatus";

interface DetourRow {
  id: string;
  number: string | null;
  closure: string;
  start_date: string | null;
  end_date: string | null;
  is_monitor_only: boolean;
  riders_directed: string | null;
  email_sent: boolean;
  expired_email_sent: boolean;
  spare_emailed: boolean;
  source: "manual" | "avail";
  external_detour_id: string | null;
  last_edited_manually: boolean;
  avail_last_seen_at: Date | null;
  // Absent (not null) on rows read before migration-024 has run.
  internal_number?: string | null;
  created_by: string;
  created_at: Date;
  updated_by: string | null;
  updated_at: Date;
}

interface SegmentRow {
  id: string;
  detour_id: string;
  routes: string;
  directions: string | null;
  sort_order: number;
}

const VALID_STATUSES: DetourStatus[] = ["monitor", "upcoming", "active", "recently_finished", "expired"];

app.http("detoursList", {
  route: "detours",
  methods: ["GET"],
  authLevel: "anonymous", // authorization enforced via requireRole below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = requireRole(request, DETOUR_READ_ROLES);
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }

    const statusParam = request.query.get("status");
    const statusFilter = VALID_STATUSES.includes(statusParam as DetourStatus)
      ? (statusParam as DetourStatus)
      : null;

    try {
      const pool = await getPool();

      // internal_number (Part B10, migration-024) is selected only once the
      // column exists - SQL Server parses the whole batch up front, so naming
      // a missing column fails even inside a CASE. Pre-migration the field
      // comes back undefined and the console falls back to hiding it, same
      // graceful-degradation pattern as every other un-run migration here.
      const numberingCheck = await pool.request().query<{ has_column: number }>(`
        SELECT CASE WHEN COL_LENGTH('dbo.Detours', 'internal_number') IS NULL
               THEN 0 ELSE 1 END AS has_column
      `);
      const hasInternalNumber = numberingCheck.recordset[0]?.has_column === 1;

      const detoursResult = await pool.request().query<DetourRow>(`
        SELECT id, number, closure, start_date, end_date, is_monitor_only, riders_directed,
               email_sent, expired_email_sent, spare_emailed, source, external_detour_id,
               last_edited_manually, avail_last_seen_at, created_by, created_at, updated_by, updated_at
               ${hasInternalNumber ? ", internal_number" : ""}
        FROM Detours
        WHERE is_deleted = 0
        ORDER BY start_date DESC, created_at DESC
      `);
      const detours = detoursResult.recordset;

      const segmentsResult = await pool.request().query<SegmentRow>(`
        SELECT s.id, s.detour_id, s.routes, s.directions, s.sort_order
        FROM DetourSegments s
        JOIN Detours d ON d.id = s.detour_id
        WHERE d.is_deleted = 0
        ORDER BY s.detour_id, s.sort_order
      `);
      const segmentsByDetour = new Map<string, SegmentRow[]>();
      for (const seg of segmentsResult.recordset) {
        const list = segmentsByDetour.get(seg.detour_id) ?? [];
        list.push(seg);
        segmentsByDetour.set(seg.detour_id, list);
      }

      const withStatus = detours.map((d) => ({
        ...d,
        status: computeDetourStatus(d),
        segments: segmentsByDetour.get(d.id) ?? [],
      }));

      const filtered = statusFilter ? withStatus.filter((d) => d.status === statusFilter) : withStatus;

      return { status: 200, jsonBody: { detours: filtered } };
    } catch (err) {
      context.error("GET /detours failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
