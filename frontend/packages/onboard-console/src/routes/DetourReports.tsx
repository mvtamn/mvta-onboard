import { Fragment, useEffect, useMemo, useState } from "react";
import {
  ApiError,
  DETOUR_STATUS_LABELS,
  DETOUR_SEVERITY_LABELS,
  type Detour,
  type DetourStatus,
  type DetourSeverity,
  type DetourReasonCode,
} from "@mvta/shared";
import { api } from "../config.js";
import {
  EMPTY_FILTERS,
  filterDetours,
  detourExportTable,
  detourExportHtml,
  detoursToCsv,
  downloadCsv,
  type DetourExportTable,
  type DetourFilters,
} from "../lib/detourSearch.js";
import { dateLabel, dateTimeLabel } from "../lib/detourDates.js";
import { availEntryLabel, communicationStatusLabel, createdByLabel, fulfillmentPathLabel, readinessLabel, sourceLabel, workflowLabel } from "../lib/detourLabels.js";
import { DetourOperationalRecord } from "../components/DetourOperationalRecord.js";
import { DetourWorkflowHistorySection } from "../components/DetourWorkflowHistorySection.js";
import { DetourAttachmentsSection } from "../components/DetourAttachments.js";
import { DetourMap } from "../components/DetourMap.js";
import { DetourDeliveryRecord } from "../components/DetourDeliveryRecord.js";
import "./modules/detourReports.css";

// Detour Reports - Part B7 of detour-module-consolidated-plan.md.
//
// Read-only by design. Detours.tsx stays the day-to-day entry/edit
// workspace; this page exists so compliance and ops leadership can search
// and reference detour history without edit controls anywhere near it - it
// replaces reaching for the Excel tracker, not the entry form. There is
// deliberately no create/edit/delete affordance here.
//
// Everything is computed from the same GET /detours payload the entry page
// uses, including the server-computed status, so the two can never disagree
// about whether a detour is Active.
//
// Status is the page's primary axis and lives in the tab bar, defaulting to
// Active: the question this page is opened with is almost always "what is
// out there right now". The tab bar replaced a status <select> plus a
// separate Show/Hide history toggle that between them decided the same
// thing twice and disagreed in some combinations. Everything else narrows
// within the chosen status and lives behind the Filters drawer, so the
// counts on the tabs always describe what the other filters already allow.

const STATUS_TABS: DetourStatus[] = ["active", "upcoming", "monitor", "recently_finished", "expired"];

const STATUS_PILL: Record<DetourStatus, string> = {
  active: "pill-success",
  upcoming: "pill-accent",
  monitor: "pill-warning",
  recently_finished: "pill-muted",
  expired: "pill-muted",
};

const COMMUNICATION_PILL: Record<string, string> = {
  published: "pill-success",
  draft: "pill-accent",
  needs_communication: "pill-warning",
};

// The status the page opens on. EMPTY_FILTERS stays the "nothing narrowed"
// baseline that Clear filters returns to, which is why it is not simply
// redefined - clearing the filters must not also throw away the tab the
// reader is looking at.
const DEFAULT_FILTERS: DetourFilters = { ...EMPTY_FILTERS, status: "active" };

// How many rows the export preview paints. The file itself always carries
// every row; the preview is there to confirm scope and columns, and a
// 900-row DOM table inside a dialog is slow for no benefit.
const PREVIEW_ROW_LIMIT = 50;

const COLUMN_COUNT = 8;

function IconSearch() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>;
}
function IconFilter() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 5h18l-7 8v6l-4 2v-8Z" /></svg>;
}
function IconDownload() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4v11" /><path d="m8 12 4 4 4-4" /><path d="M5 20h14" /></svg>;
}
function IconOpenTab() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 4h6v6" /><path d="M20 4 11 13" /><path d="M18 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" /></svg>;
}
function IconChevron() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>;
}
function IconRemove() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>;
}

export function DetourReports() {
  const [detours, setDetours] = useState<Detour[] | null>(null);
  const [reasonCodes, setReasonCodes] = useState<DetourReasonCode[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filters, setFilters] = useState<DetourFilters>(DEFAULT_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ filename: string; scope: string; table: DetourExportTable } | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    api
      .getDetours()
      .then((d) => {
        setDetours(d.detours);
        setLoadError(null);
      })
      .catch((err) => {
        setDetours(null);
        setLoadError(
          err instanceof ApiError
            ? `Could not load detours: ${err.message}`
            : "Could not reach the detour service.",
        );
      });
    api
      .getDetourReasonCodes()
      .then((r) => setReasonCodes(r.reason_codes))
      .catch(() => setReasonCodes([]));
  }, []);

  // Same two-signal check as Detours.tsx - the B6 columns may not exist in
  // this environment yet, in which case those filters and detail fields are
  // simply absent rather than rendering a wall of dashes.
  const reportingReady =
    reasonCodes.length > 0 || (detours?.some((d) => "reason_code" in d) ?? false);

  // Everything except status, so a tab's count describes what the rest of
  // the filters already allow rather than the whole table.
  const pool = useMemo(
    () => (detours ? filterDetours(detours, { ...filters, status: "all" }, reasonCodes) : []),
    [detours, filters, reasonCodes],
  );
  const visible = useMemo(
    () => (filters.status === "all" ? pool : pool.filter((d) => d.status === filters.status)),
    [pool, filters.status],
  );

  function set<K extends keyof DetourFilters>(key: K, value: DetourFilters[K]) {
    setFilters((f) => ({ ...f, [key]: value }));
    setExpandedId(null);
  }

  function reasonLabelOf(code: string | null | undefined): string {
    if (!code) return "—";
    return reasonCodes.find((rc) => rc.code === code)?.label ?? code;
  }

  const chips: { key: string; label: string; clear: () => void }[] = [];
  if (filters.search.trim()) chips.push({ key: "search", label: `“${filters.search.trim()}”`, clear: () => set("search", "") });
  if (filters.source !== "all") chips.push({ key: "source", label: filters.source === "avail" ? "Avail sync" : "Manual", clear: () => set("source", "all") });
  if (filters.reasonCode !== "all") chips.push({ key: "reason", label: reasonLabelOf(filters.reasonCode), clear: () => set("reasonCode", "all") });
  if (filters.severity !== "all") chips.push({ key: "severity", label: DETOUR_SEVERITY_LABELS[filters.severity as DetourSeverity] ?? filters.severity, clear: () => set("severity", "all") });
  if (filters.startFrom) chips.push({ key: "from", label: `Starts on or after ${filters.startFrom}`, clear: () => set("startFrom", "") });
  if (filters.startTo) chips.push({ key: "to", label: `Starts on or before ${filters.startTo}`, clear: () => set("startTo", "") });

  // The drawer's badge counts only what is inside the drawer; the search
  // box and the status tab carry their own visible state.
  const drawerFilterCount = chips.filter((c) => c.key !== "search").length;

  function clearFilters() {
    // Deliberately keeps the status tab: it is the page's axis, not a
    // filter the reader forgot they set.
    setFilters((f) => ({ ...EMPTY_FILTERS, status: f.status }));
    setExpandedId(null);
  }

  function scopeSentence(): string {
    const statusPart = filters.status === "all" ? "All statuses" : DETOUR_STATUS_LABELS[filters.status];
    const rest = chips.map((c) => c.label);
    return rest.length ? `${statusPart} · ${rest.join(" · ")}` : statusPart;
  }

  function openPreview() {
    // Exports what is on screen, not the whole table - the filters are the
    // point of the export.
    const stamp = new Date().toISOString().slice(0, 10);
    setPreview({
      filename: `mvta-detours-${stamp}.csv`,
      scope: scopeSentence(),
      table: detourExportTable(visible, reasonCodes),
    });
  }

  // The same export offered as a page the browser can render. Built as a
  // blob URL so the anchor opens a real tab (a scripted window.open here
  // would be popup-blocked); revoked when the dialog closes.
  useEffect(() => {
    if (!preview) {
      setPreviewUrl(null);
      return;
    }
    if (typeof URL.createObjectURL !== "function") return;
    const blob = new Blob([detourExportHtml(preview.filename, preview.table, preview.scope)], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    setPreviewUrl(url);
    return () => {
      URL.revokeObjectURL(url);
      setPreviewUrl(null);
    };
  }, [preview]);

  useEffect(() => {
    if (!preview) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setPreview(null); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [preview]);

  function downloadFromPreview() {
    if (!preview) return;
    downloadCsv(preview.filename, detoursToCsv(visible, reasonCodes));
  }

  return (
    <>
      <div className="panel-header">
        <span>Detour Reports</span>
        <span className="chip" style={{ marginRight: 0 }}>Read-only</span>
      </div>
      <div className="panel-body">
        <p className="panel-desc">
          Every detour and closure on record, searchable by any field. Entry and edits happen on
          Detours &amp; Closures.
        </p>

        <div className="dr-toolbar">
          <div className="dr-searchwrap">
            <IconSearch />
            <input
              className="dr-search"
              type="search"
              aria-label="Search detours"
              value={filters.search}
              onChange={(e) => set("search", e.target.value)}
              placeholder="Closure, route, detour number, staff name, location…"
            />
          </div>
          <button
            type="button"
            className={`dr-btn${filtersOpen ? " is-on" : ""}`}
            aria-expanded={filtersOpen}
            aria-controls="dr-filter-drawer"
            onClick={() => setFiltersOpen((open) => !open)}
          >
            <IconFilter />
            <span>Filters</span>
            {drawerFilterCount > 0 ? <span className="dr-count-badge">{drawerFilterCount}</span> : null}
          </button>
          <button
            type="button"
            className="dr-btn dr-primary"
            disabled={visible.length === 0}
            onClick={openPreview}
          >
            <IconDownload />
            <span>Export {visible.length} {visible.length === 1 ? "row" : "rows"}</span>
          </button>
        </div>

        {filtersOpen ? (
          <div className="dr-filters" id="dr-filter-drawer">
            <div>
              <label htmlFor="dr-source">Source</label>
              <select id="dr-source" className="f" value={filters.source} onChange={(e) => set("source", e.target.value as DetourFilters["source"])}>
                <option value="all">All sources</option>
                <option value="manual">Manual</option>
                <option value="avail">Avail sync</option>
              </select>
            </div>
            {reportingReady ? (
              <>
                <div>
                  <label htmlFor="dr-reason">Reason category</label>
                  <select id="dr-reason" className="f" value={filters.reasonCode} onChange={(e) => set("reasonCode", e.target.value)}>
                    <option value="all">All reasons</option>
                    {reasonCodes.map((rc) => (
                      <option key={rc.id} value={rc.code}>{rc.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="dr-severity">Severity</label>
                  <select id="dr-severity" className="f" value={filters.severity} onChange={(e) => set("severity", e.target.value)}>
                    <option value="all">All severities</option>
                    {(Object.keys(DETOUR_SEVERITY_LABELS) as DetourSeverity[]).map((s) => (
                      <option key={s} value={s}>{DETOUR_SEVERITY_LABELS[s]}</option>
                    ))}
                  </select>
                </div>
              </>
            ) : null}
            <div>
              <label htmlFor="dr-from">Starts on or after</label>
              <input id="dr-from" className="f" type="date" value={filters.startFrom} onChange={(e) => set("startFrom", e.target.value)} />
            </div>
            <div>
              <label htmlFor="dr-to">Starts on or before</label>
              <input id="dr-to" className="f" type="date" value={filters.startTo} onChange={(e) => set("startTo", e.target.value)} />
            </div>
          </div>
        ) : null}

        {chips.length > 0 ? (
          <div className="dr-chiprow">
            {chips.map((chip) => (
              <button key={chip.key} type="button" className="dr-chip" onClick={chip.clear}>
                {chip.label}
                <IconRemove />
              </button>
            ))}
            <button type="button" className="dr-clear-all" onClick={clearFilters}>Clear filters</button>
          </div>
        ) : null}

        <div className="dr-tabs" role="group" aria-label="Filter by detour status">
          {STATUS_TABS.map((status) => (
            <button
              key={status}
              type="button"
              className="dr-tab"
              aria-pressed={filters.status === status}
              onClick={() => set("status", status)}
            >
              {DETOUR_STATUS_LABELS[status]}
              <span className="dr-n">{pool.filter((d) => d.status === status).length}</span>
            </button>
          ))}
          <button
            type="button"
            className="dr-tab"
            aria-pressed={filters.status === "all"}
            onClick={() => set("status", "all")}
          >
            All
            <span className="dr-n">{pool.length}</span>
          </button>
          <span className="dr-tabcount">
            {detours === null ? "…" : `${visible.length} of ${detours.length} detours`}
          </span>
        </div>

        {loadError ? <p className="error-text">{loadError}</p> : null}

        <div className="dr-tablewrap">
          {detours === null && !loadError ? (
            <div className="dr-skeleton" aria-busy="true" aria-label="Loading detours">
              {[0, 1, 2, 3, 4].map((i) => (
                <div className="dr-skeleton-row" key={i}>
                  <span className="dr-bar" />
                  <span className="dr-bar" style={{ width: `${80 - i * 9}%` }} />
                  <span className="dr-bar" />
                  <span className="dr-bar" />
                  <span className="dr-bar" />
                </div>
              ))}
            </div>
          ) : null}

          {detours !== null && visible.length === 0 ? (
            <div className="dr-empty">
              <IconSearch />
              {detours.length === 0 ? (
                <>
                  <b>No detours on record yet</b>
                  <span>Detours appear here as soon as they are entered on Detours &amp; Closures, or synced from Avail.</span>
                </>
              ) : pool.length === 0 ? (
                <>
                  <b>Nothing matches this search</b>
                  <span>Try fewer words, or clear the filters above.</span>
                  <div className="dr-empty-actions">
                    <button type="button" className="dr-btn" onClick={clearFilters}>Clear filters</button>
                  </div>
                </>
              ) : (
                <>
                  <b>No {DETOUR_STATUS_LABELS[filters.status as DetourStatus].toLowerCase()} detours match</b>
                  <span>Other statuses still have matches — the counts on the tabs show where.</span>
                  <div className="dr-empty-actions">
                    <button type="button" className="dr-btn" onClick={() => set("status", "all")}>
                      See all {pool.length} {pool.length === 1 ? "match" : "matches"}
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : null}

          {visible.length > 0 ? (
            <table className="data dr-table">
              <thead>
                <tr>
                  <th>Internal ref</th>
                  <th>Closure</th>
                  <th>Routes</th>
                  <th>Dates</th>
                  <th>Status</th>
                  <th>Readiness &amp; owner</th>
                  <th>Communications</th>
                  <th><span className="sr-only">Details</span></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((d) => {
                  const open = expandedId === d.id;
                  const flag = d.conflicts?.length
                    ? d.conflict_status === "overridden" ? "Conflict overridden" : "Conflict needs override"
                    : d.review_status === "needs_review" ? "Needs OCC re-review" : "";
                  return (
                    <Fragment key={d.id}>
                      <tr className={`dr-row${open ? " is-open" : ""}`} onClick={() => setExpandedId(open ? null : d.id)}>
                        <td className="dr-ref">{d.internal_number || "—"}{d.number ? <small>{d.number}</small> : null}</td>
                        <td><div className="dr-closure">{d.closure}</div></td>
                        <td className="td-dim">{d.segments.map((s) => s.routes).join("; ") || "—"}</td>
                        <td className="td-dim dr-nowrap">{dateLabel(d.start_date)} – {dateLabel(d.end_date)}</td>
                        <td><span className={`pill-sm ${STATUS_PILL[d.status]}`}>{DETOUR_STATUS_LABELS[d.status]}</span></td>
                        <td className="td-dim">
                          {readinessLabel({ readiness: d.readiness, review_status: "current", conflict_status: "none" })}
                          <span className="dr-owner">{d.workflow_owner || "Unassigned"}</span>
                          {flag ? <span className={`dr-flag${d.conflict_status === "unresolved" ? " is-bad" : ""}`}>{flag}</span> : null}
                        </td>
                        <td>
                          <span className={`pill-sm ${COMMUNICATION_PILL[d.communication_status ?? ""] ?? "pill-muted"}`}>
                            {communicationStatusLabel(d)}
                          </span>
                        </td>
                        <td className="dr-chevcell">
                          <button
                            type="button"
                            className="dr-chev"
                            aria-expanded={open}
                            aria-label={open ? `Hide the record for ${d.closure}` : `Show the record for ${d.closure}`}
                            onClick={(e) => { e.stopPropagation(); setExpandedId(open ? null : d.id); }}
                          >
                            <IconChevron />
                          </button>
                        </td>
                      </tr>
                      {open ? (
                        <tr>
                          <td className="dr-detailcell" colSpan={COLUMN_COUNT}>
                            <div className="dr-detail">
                              <div className="dr-group">
                                <h4>Classification &amp; provenance</h4>
                                <dl className="dr-dl">
                                  {reportingReady ? <div><dt>Reason</dt><dd>{reasonLabelOf(d.reason_code)}</dd></div> : null}
                                  {reportingReady ? <div><dt>Severity</dt><dd>{d.severity ? DETOUR_SEVERITY_LABELS[d.severity] : "—"}</dd></div> : null}
                                  <div><dt>Avail number</dt><dd>{d.number || "—"}</dd></div>
                                  <div><dt>Fulfillment path</dt><dd>{fulfillmentPathLabel(d)}</dd></div>
                                  <div><dt>Workflow</dt><dd>{workflowLabel(d)}</dd></div>
                                  <div><dt>Readiness</dt><dd>{readinessLabel(d)}</dd></div>
                                  <div><dt>Source</dt><dd>{sourceLabel(d)}</dd></div>
                                  {d.reported_by || d.reported_at ? (
                                    <div><dt>Reported by</dt><dd>{d.reported_by || "—"}{d.reported_at ? ` · ${dateTimeLabel(d.reported_at)}` : ""}</dd></div>
                                  ) : null}
                                  {d.approved_by || d.approved_at ? (
                                    <div><dt>Approved by</dt><dd>{d.approved_by || "—"}{d.approved_at ? ` · ${dateTimeLabel(d.approved_at)}` : ""}</dd></div>
                                  ) : null}
                                  {d.fulfillment_mode === "avail" ? (
                                    <div>
                                      <dt>Avail entry</dt>
                                      <dd>
                                        {availEntryLabel(d)}
                                        {d.external_detour_id ? ` · ID ${d.external_detour_id}` : ""}
                                        {d.avail_last_seen_at ? ` · Last seen ${dateTimeLabel(d.avail_last_seen_at)}` : ""}
                                      </dd>
                                    </div>
                                  ) : null}
                                  {d.riders_directed ? <div><dt>Riders directed</dt><dd>{d.riders_directed}</dd></div> : null}
                                  {d.resolution_notes ? <div><dt>Resolution</dt><dd>{d.resolution_notes}</dd></div> : null}
                                  {d.closure_reason ? <div><dt>Closure reason</dt><dd>{d.closure_reason}</dd></div> : null}
                                </dl>
                              </div>

                              <div className="dr-notifs">
                                <b>Notified</b>
                                <span className={`dr-nchip ${d.email_sent ? "is-yes" : "is-no"}`}>Email</span>
                                <span className={`dr-nchip ${d.expired_email_sent ? "is-yes" : "is-no"}`}>Expired email</span>
                                <span className={`dr-nchip ${d.spare_emailed ? "is-yes" : "is-no"}`}>Spare</span>
                                {reportingReady ? (
                                  <>
                                    <span className={`dr-nchip ${d.radio_notified ? "is-yes" : "is-no"}`}>Radio</span>
                                    <span className={`dr-nchip ${d.dispatch_board_notified ? "is-yes" : "is-no"}`}>Dispatch board</span>
                                    <span className={`dr-nchip ${d.social_media_notified ? "is-yes" : "is-no"}`}>Social media</span>
                                  </>
                                ) : null}
                              </div>

                              {d.conflicts?.length ? (
                                <p className={d.conflict_status === "overridden" ? "td-dim" : "warn-note"} style={{ margin: 0 }}>
                                  <b>{d.conflict_status === "overridden" ? "Conflict overridden" : "Conflict needs override"}:</b>{" "}
                                  {d.conflicts.map((c) => `${c.label} (${c.shared.join(", ")})`).join("; ")}
                                  {d.conflict_status === "overridden" ? ` — ${d.conflict_override_reason} · ${d.conflict_override_by}${d.conflict_override_at ? ` ${dateTimeLabel(d.conflict_override_at)}` : ""}` : ""}
                                </p>
                              ) : null}

                              {d.segments.length > 0 ? (
                                <div className="dr-group">
                                  <h4>Route segments</h4>
                                  <dl className="dr-dl">
                                    {d.segments.map((s) => (
                                      <div key={s.id}><dt>{s.routes}</dt><dd>{s.directions || "Both directions not recorded"}</dd></div>
                                    ))}
                                  </dl>
                                </div>
                              ) : null}

                              <DetourOperationalRecord detour={d} />

                              {d.geometry_json ? (
                                <div>
                                  <p className="field-label">Map</p>
                                  <DetourMap value={d.geometry_json} onChange={() => undefined} readOnly height={260} />
                                </div>
                              ) : null}

                              {/* Read-only: the reports page never edits, but
                                  the document that went out with a detour is
                                  part of the record a compliance reader needs. */}
                              <DetourDeliveryRecord detourId={d.id} />
                              <DetourAttachmentsSection detourId={d.id} canWrite={false} />
                              <DetourWorkflowHistorySection detourId={d.id} />

                              <p className="dr-prov">
                                Created by {createdByLabel(d)} on {dateTimeLabel(d.created_at)}
                                {d.updated_by ? ` · Last edited by ${d.updated_by} on ${dateTimeLabel(d.updated_at)}` : ""}
                              </p>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          ) : null}
        </div>
      </div>

      {preview ? (
        <div
          className="modal-overlay"
          role="presentation"
          onMouseDown={(event) => { if (event.target === event.currentTarget) setPreview(null); }}
        >
          <div className="modal-card dr-preview-card" role="dialog" aria-modal="true" aria-labelledby="dr-preview-title">
            <div className="modal-card-header">
              <div>
                <span className="eyebrow">Export</span>
                <h2 id="dr-preview-title">Detour export preview</h2>
              </div>
              <button className="btn-icon" type="button" aria-label="Close preview" onClick={() => setPreview(null)}>×</button>
            </div>
            <p className="dr-preview-meta">
              <span className="dr-preview-file">{preview.filename}</span>
              <span>{preview.table.rows.length} {preview.table.rows.length === 1 ? "detour" : "detours"} · {preview.table.headers.length} columns</span>
            </p>
            <p className="dr-preview-scope">{preview.scope}</p>
            <div className="dr-preview-tablewrap">
              <table className="data">
                <thead>
                  <tr>{preview.table.headers.map((h) => <th key={h}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {preview.table.rows.slice(0, PREVIEW_ROW_LIMIT).map((row, i) => (
                    <tr key={i}>{row.map((cell, j) => <td key={j} title={cell}>{cell || "—"}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="dr-preview-note">
              {preview.table.rows.length > PREVIEW_ROW_LIMIT
                ? `Showing the first ${PREVIEW_ROW_LIMIT} of ${preview.table.rows.length} rows. The file and the browser view both carry all ${preview.table.rows.length}.`
                : "This is the whole file — every row and column it will contain."}
            </p>
            <div className="dr-preview-actions">
              <span className="dr-spacer" />
              {previewUrl ? (
                <a className="dr-btn" href={previewUrl} target="_blank" rel="noreferrer">
                  <IconOpenTab />
                  <span>Open in browser</span>
                </a>
              ) : null}
              <button type="button" className="dr-btn" onClick={() => setPreview(null)}>Close</button>
              <button type="button" className="dr-btn dr-primary" onClick={downloadFromPreview}>
                <IconDownload />
                <span>Download CSV</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
