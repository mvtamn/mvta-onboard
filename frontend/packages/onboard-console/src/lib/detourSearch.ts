// Search, filter and CSV export for the detour module - Part B7 of
// detour-module-consolidated-plan.md.
//
// Client-side by design: GET /detours already returns every non-deleted row
// (there is no pagination), so both the day-to-day Detours page and the
// read-only Detour Reports page filter what they already have rather than
// round-tripping. FLAGGED AS AN ASSUMPTION in the plan and repeated here:
// if real detour volume ever makes a full scan slow, this is the seam to
// move server-side - both pages call these two functions and nothing else.
import {
  DETOUR_STATUS_LABELS,
  DETOUR_SEVERITY_LABELS,
  type Detour,
  type DetourHistoricalImportRow,
  type DetourStatus,
  type DetourReasonCode,
} from "@mvta/shared";
import { toDateOnly } from "./detourDates.js";
import { availEntryLabel, communicationStatusLabel, conflictLabel, createdByLabel, fulfillmentPathLabel, readinessLabel, sourceLabel, workflowLabel } from "./detourLabels.js";

export interface DetourFilters {
  search: string;
  status: DetourStatus | "all";
  reasonCode: string | "all";
  severity: string | "all";
  source: "manual" | "avail" | "all";
  startFrom: string; // YYYY-MM-DD, inclusive
  startTo: string;   // YYYY-MM-DD, inclusive
}

export const EMPTY_FILTERS: DetourFilters = {
  search: "",
  status: "all",
  reasonCode: "all",
  severity: "all",
  source: "all",
  startFrom: "",
  startTo: "",
};

function reasonLabel(code: string | null | undefined, reasonCodes: DetourReasonCode[]): string {
  if (!code) return "";
  return reasonCodes.find((r) => r.code === code)?.label ?? code;
}

// Everything a free-text search should reach, flattened into one string.
// Reason codes are searched by their human LABEL as well as their raw code,
// so typing "special event" finds rows stored as `special_event`.
function haystack(d: Detour, reasonCodes: DetourReasonCode[]): string {
  return [
    d.number,
    d.internal_number,
    d.closure,
    d.riders_directed,
    d.reason_code,
    reasonLabel(d.reason_code, reasonCodes),
    d.severity,
    d.reported_by,
    d.approved_by,
    d.resolution_notes,
    d.location,
    d.action_instructions,
    d.service_area,
    d.affected_stops_and_stations,
    d.operational_impacts,
    d.confirmation_contact,
    d.evidence_reference,
    ...(d.notification_audiences ?? []),
    ...(d.notification_channels ?? []),
    ...d.segments.flatMap((s) => [s.routes, s.directions]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

// Every term must match somewhere (AND, not phrase) - "465 washington"
// finds the UofM closure regardless of which field holds which word.
export function detourMatchesSearch(
  d: Detour,
  search: string,
  reasonCodes: DetourReasonCode[] = [],
): boolean {
  const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const hay = haystack(d, reasonCodes);
  return terms.every((t) => hay.includes(t));
}

// The Reports search box also reaches the legacy tracker rows, using the
// same every-term-must-match rule, so one query covers the whole record.
export function historicalRowMatchesSearch(row: DetourHistoricalImportRow, search: string): boolean {
  const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const hay = [
    row.historical_reference, row.closure, row.service_date, row.routes,
    row.communication_audience, row.communication_channel, row.communication_recipients, row.communication_content,
    row.source_file,
  ].filter(Boolean).join(" ").toLowerCase();
  return terms.every((t) => hay.includes(t));
}

export function filterDetours(
  detours: Detour[],
  filters: DetourFilters,
  reasonCodes: DetourReasonCode[] = [],
): Detour[] {
  return detours.filter((d) => {
    if (filters.status !== "all" && d.status !== filters.status) return false;
    if (filters.reasonCode !== "all" && (d.reason_code ?? "") !== filters.reasonCode) return false;
    if (filters.severity !== "all" && (d.severity ?? "") !== filters.severity) return false;
    if (filters.source !== "all" && d.source !== filters.source) return false;
    // Date range is on start_date. Open-ended/undated rows have no
    // start_date at all and are excluded once a range is set, rather than
    // being silently swept into every range.
    //
    // Compared date-only. The filter inputs produce YYYY-MM-DD, so an
    // un-normalized ISO start_date would compare as
    // "2026-08-08T00:00:00.000Z" > "2026-08-08" and drop every row landing
    // exactly on the upper bound.
    if (filters.startFrom || filters.startTo) {
      const start = toDateOnly(d.start_date);
      if (!start) return false;
      if (filters.startFrom && start < filters.startFrom) return false;
      if (filters.startTo && start > filters.startTo) return false;
    }
    return detourMatchesSearch(d, filters.search, reasonCodes);
  });
}

// Excel is the destination for these exports (it is what this module
// replaced), so: CRLF line endings, and every field quoted with embedded
// quotes doubled - the closure text routinely contains commas.
function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

// Column order follows the Detour Reports table, then the expanded-row
// detail, then the operational record - a reader comparing the export to
// the screen finds things where they expect them.
const CSV_HEADERS = [
  "Internal ref", "Number", "Closure", "Routes", "Start date", "End date", "Status",
  "Path", "Readiness", "Next owner", "Communications", "Workflow",
  "Reason", "Severity", "Created by", "Source",
  "Riders directed",
  "Reported by", "Reported at", "Approved by", "Approved at",
  "Email sent", "Expired email sent", "Spare emailed",
  "Radio", "Dispatch board", "Social media",
  "Resolution notes", "Closure reason", "Re-review reason", "Conflicts",
  "Avail entry", "Avail detour ID", "Avail last seen",
  "Created at", "Last edited by", "Last edited at",
  // Operational record carried from intake (migrations 057/069). Blank
  // for detours entered directly on the Detours page, which never had it.
  "Location", "Start time", "End time", "Window status", "Service impact", "Service area",
  "Affected stops and stations", "Action instructions", "Operational impacts",
  "Required audiences", "Required channels", "Confirmation contact",
  "Evidence notes", "Evidence reference",
];

// One detour, one row of already-stringified cells, in CSV_HEADERS order.
// The Reports page's export preview renders this table directly rather than
// re-parsing the CSV, so what a reader sees on screen and what lands in the
// file cannot drift apart.
export interface DetourExportTable {
  headers: string[];
  rows: string[][];
}

export function detourExportTable(
  detours: Detour[],
  reasonCodes: DetourReasonCode[] = [],
): DetourExportTable {
  const rows = detours.map((d) =>
    [
      d.internal_number ?? "",
      d.number ?? "",
      d.closure,
      // Segments collapse into one cell - a CSV row is one detour, and
      // exploding to one row per segment would break the "one line per
      // detour" reading these exports get pasted into.
      d.segments.map((s) => s.routes).join("; "),
      // Date-only, so Excel reads these as dates rather than as opaque
      // timestamp text.
      toDateOnly(d.start_date) ?? "",
      toDateOnly(d.end_date) ?? "",
      DETOUR_STATUS_LABELS[d.status],
      fulfillmentPathLabel(d),
      readinessLabel(d),
      d.workflow_owner || "Unassigned",
      communicationStatusLabel(d),
      workflowLabel(d),
      reasonLabel(d.reason_code, reasonCodes),
      d.severity ? DETOUR_SEVERITY_LABELS[d.severity] : "",
      createdByLabel(d),
      sourceLabel(d),
      d.riders_directed ?? "",
      d.reported_by ?? "",
      d.reported_at ?? "",
      d.approved_by ?? "",
      d.approved_at ?? "",
      d.email_sent ? "Yes" : "No",
      d.expired_email_sent ? "Yes" : "No",
      d.spare_emailed ? "Yes" : "No",
      d.radio_notified ? "Yes" : "No",
      d.dispatch_board_notified ? "Yes" : "No",
      d.social_media_notified ? "Yes" : "No",
      d.resolution_notes ?? "",
      d.closure_reason ?? "",
      d.review_status === "needs_review" ? d.review_reason ?? "" : "",
      conflictLabel(d),
      availEntryLabel(d),
      d.external_detour_id ?? "",
      d.avail_last_seen_at ?? "",
      d.created_at,
      d.updated_by ?? "",
      d.updated_by ? d.updated_at : "",
      d.location ?? "",
      d.start_time ?? "",
      d.end_time ?? "",
      d.time_window_status ?? "",
      d.service_impact ?? "",
      d.service_area ?? "",
      d.affected_stops_and_stations ?? "",
      d.action_instructions ?? "",
      d.operational_impacts ?? "",
      (d.notification_audiences ?? []).join("; "),
      (d.notification_channels ?? []).join("; "),
      d.confirmation_contact ?? "",
      d.evidence_notes ?? "",
      d.evidence_reference ?? "",
    ].map((value) => (value === null || value === undefined ? "" : String(value))),
  );
  return { headers: CSV_HEADERS, rows };
}

export function detoursToCsv(detours: Detour[], reasonCodes: DetourReasonCode[] = []): string {
  const { headers, rows } = detourExportTable(detours, reasonCodes);
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

export function downloadCsv(filename: string, csv: string): void {
  // BOM so Excel opens UTF-8 route/street names correctly instead of
  // mangling them into Latin-1.
  const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// The same export as a standalone HTML document, so the file can be read in
// a browser tab instead of only landing in Excel. Self-contained (inline
// styles, no fetches) because it is handed to the browser as a blob URL,
// which has no origin to load anything from.
export function detourExportHtml(filename: string, table: DetourExportTable, scope: string): string {
  const head = table.headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("");
  const body = table.rows
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell) || "&#8212;"}</td>`).join("")}</tr>`)
    .join("");
  const rowLabel = `${table.rows.length} ${table.rows.length === 1 ? "detour" : "detours"} · ${table.headers.length} columns`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(filename)}</title>
<style>
  :root { color-scheme: light; }
  body { background: #edebe4; color: #2c2c2a; font-family: -apple-system, "Segoe UI", Inter, Roboto, Arial, sans-serif; font-size: 13px; margin: 0; padding: 24px; }
  header { margin-bottom: 14px; }
  h1 { font-size: 19px; letter-spacing: -.01em; margin: 0 0 4px; }
  .meta { color: #4f4f4f; font-size: 12px; margin: 0; }
  .scope { color: #8a8a82; font-size: 12px; margin: 4px 0 0; }
  .wrap { background: #fff; border: 1px solid #ddd; border-radius: 10px; box-shadow: 0 2px 8px rgba(0,0,0,.04); max-height: calc(100vh - 130px); overflow: auto; }
  /* 51 columns: size to content and scroll sideways rather than squeezing
     every closure into a four-word column. */
  table { border-collapse: separate; border-spacing: 0; font-size: 12px; min-width: 100%; width: max-content; }
  th { background: #00553d; color: #fff; font-size: 11px; letter-spacing: .3px; padding: 9px 12px; position: sticky; text-align: left; top: 0; white-space: nowrap; }
  td { border-bottom: 1px solid #eee; max-width: 46ch; padding: 8px 12px; vertical-align: top; }
  tr:nth-child(even) td { background: #fafaf8; }
  td:first-child { font-variant-numeric: tabular-nums; white-space: nowrap; }
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(filename)}</h1>
  <p class="meta">${escapeHtml(rowLabel)}</p>
  <p class="scope">${escapeHtml(scope)}</p>
</header>
<div class="wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>
</body>
</html>`;
}
