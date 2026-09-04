import { Fragment, useEffect, useState } from "react";
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
  detoursToCsv,
  downloadCsv,
  type DetourFilters,
} from "../lib/detourSearch.js";
import { dateLabel, dateTimeLabel } from "../lib/detourDates.js";
import { availEntryLabel, communicationStatusLabel, createdByLabel, fulfillmentPathLabel, readinessLabel, sourceLabel, workflowLabel } from "../lib/detourLabels.js";
import { DetourOperationalRecord } from "../components/DetourOperationalRecord.js";

// Detour Reports - Part B7 of detour-module-consolidated-plan.md.
//
// Read-only by design. Detours.tsx stays the day-to-day entry/edit
// workspace; this page exists so compliance and ops leadership can search
// and reference detour history without edit controls anywhere near it - it
// replaces reaching for the Excel tracker, not the entry form. There is
// deliberately no create/edit/delete affordance here even for users who
// have those rights on the other page.
//
// Everything is computed from the same GET /detours payload the entry page
// uses, including the server-computed status, so the two can never disagree
// about whether a detour is Active.

const STATUS_OPTIONS: (DetourStatus | "all")[] = [
  "all", "active", "upcoming", "monitor", "recently_finished", "expired",
];

const STATUS_PILL: Record<DetourStatus, string> = {
  active: "pill-success",
  upcoming: "pill-accent",
  monitor: "pill-warning",
  recently_finished: "pill-muted",
  expired: "pill-muted",
};

export function DetourReports() {
  const [detours, setDetours] = useState<Detour[] | null>(null);
  const [reasonCodes, setReasonCodes] = useState<DetourReasonCode[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filters, setFilters] = useState<DetourFilters>(EMPTY_FILTERS);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

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
  // this environment yet, in which case those columns and filters are
  // simply absent rather than rendering a wall of dashes.
  const reportingReady =
    reasonCodes.length > 0 || (detours?.some((d) => "reason_code" in d) ?? false);

  function set<K extends keyof DetourFilters>(key: K, value: DetourFilters[K]) {
    setFilters((f) => ({ ...f, [key]: value }));
  }

  const historicalFilterSelected = filters.status !== "all" && filters.status !== "active" && filters.status !== "upcoming";
  const visible = detours ? filterDetours(detours, filters, reasonCodes).filter((d) => showHistory || historicalFilterSelected || d.status === "active" || d.status === "upcoming") : [];
  const filtersActive = JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS);

  function exportCsv() {
    // Exports what is on screen, not the whole table - the filters are the
    // point of the export.
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`mvta-detours-${stamp}.csv`, detoursToCsv(visible, reasonCodes));
  }

  function reasonLabelOf(code: string | null | undefined): string {
    if (!code) return "—";
    return reasonCodes.find((rc) => rc.code === code)?.label ?? code;
  }

  async function importLegacyFile(file: File) {
    try {
      const text = await file.text();
      const rows = file.name.toLowerCase().endsWith(".json") ? JSON.parse(text) : text.trim().split(/\r?\n/).slice(1).map((line) => {
        const values = line.split(",");
        return { reference: values[0], closure: values[1], service_date: values[2], routes: values[3], communication_audience: values[4], communication_channel: values[5], communication_recipients: values[6], communication_content: values.slice(7).join(",") };
      });
      const result = await api.importHistoricalDetours({ source_file: file.name, rows: Array.isArray(rows) ? rows : rows.rows });
      setImportMessage(`Imported ${result.imported_rows} historical rows. They remain historical evidence and do not become approvals.`);
    } catch (err) { setImportMessage(err instanceof ApiError ? err.message : "Could not import the historical file"); }
  }

  return (
    <>
      <div className="panel-header">Detour Reports</div>
      <div className="panel-body">
        <p className="panel-desc" style={{ marginBottom: 10 }}>
          Search and reference every detour and closure on record, active or expired. Read-only —
          entry and edits happen on Detours &amp; Closures.
        </p>

        <div className="field-grid" style={{ marginBottom: 8 }}>
          <div>
            <p className="field-label">Search</p>
            <input
              className="f"
              type="search"
              value={filters.search}
              onChange={(e) => set("search", e.target.value)}
              placeholder="Closure, routes, number, staff name…"
            />
          </div>
          <div>
            <p className="field-label">Status</p>
            <select className="f" value={filters.status} onChange={(e) => set("status", e.target.value as DetourStatus | "all")}>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>{s === "all" ? "All statuses" : DETOUR_STATUS_LABELS[s]}</option>
              ))}
            </select>
          </div>
          <div>
            <p className="field-label">Source</p>
            <select className="f" value={filters.source} onChange={(e) => set("source", e.target.value as DetourFilters["source"])}>
              <option value="all">All sources</option>
              <option value="manual">Manual</option>
              <option value="avail">Avail sync</option>
            </select>
          </div>
        </div>

        <div className="field-grid" style={{ marginBottom: 8 }}>
          {reportingReady && (
            <>
              <div>
                <p className="field-label">Reason category</p>
                <select className="f" value={filters.reasonCode} onChange={(e) => set("reasonCode", e.target.value)}>
                  <option value="all">All reasons</option>
                  {reasonCodes.map((rc) => (
                    <option key={rc.id} value={rc.code}>{rc.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <p className="field-label">Severity</p>
                <select className="f" value={filters.severity} onChange={(e) => set("severity", e.target.value)}>
                  <option value="all">All severities</option>
                  {(Object.keys(DETOUR_SEVERITY_LABELS) as DetourSeverity[]).map((s) => (
                    <option key={s} value={s}>{DETOUR_SEVERITY_LABELS[s]}</option>
                  ))}
                </select>
              </div>
            </>
          )}
          <div>
            <p className="field-label">Starts on or after</p>
            <input className="f" type="date" value={filters.startFrom} onChange={(e) => set("startFrom", e.target.value)} />
          </div>
          <div>
            <p className="field-label">Starts on or before</p>
            <input className="f" type="date" value={filters.startTo} onChange={(e) => set("startTo", e.target.value)} />
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
          <span className="td-dim">
            {detours === null ? "…" : `${visible.length} of ${detours.length} detours`}
          </span>
          <button className="btn-sm" aria-pressed={showHistory} onClick={() => setShowHistory((current) => !current)}>
            {showHistory ? "Hide history" : "Show history"}
          </button>
          {filtersActive ? (
            <button className="btn-sm" onClick={() => setFilters(EMPTY_FILTERS)}>Clear filters</button>
          ) : null}
          <button className="btn-sm" disabled={visible.length === 0} onClick={exportCsv} style={{ marginLeft: "auto" }}>
            Download CSV
          </button>
        </div>
        <div className="subcard" style={{ marginBottom: 12 }}>
          <b>Legacy spreadsheet history</b>
          <p className="td-dim">Upload CSV or JSON rows to preserve historical tracking and communication evidence. Imported rows are never treated as current approvals.</p>
          <input type="file" accept=".csv,.json" onChange={(e) => { const file = e.target.files?.[0]; if (file) void importLegacyFile(file); }} />
          {importMessage ? <p className="td-dim">{importMessage}</p> : null}
        </div>

        {loadError ? <p className="error-text">{loadError}</p> : null}
        {detours === null && !loadError ? <p className="muted">Loading…</p> : null}
        {detours !== null && visible.length === 0 ? (
          <div className="subcard empty-note" style={{ textAlign: "center", padding: "30px 20px" }}>
            {detours.length === 0 ? "No detours on record yet." : "No detours match these filters."}
          </div>
        ) : null}

        {visible.length > 0 && (
          <div className="subcard" style={{ overflow: "hidden" }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Internal ref</th>
                  <th>Number</th>
                  <th>Closure</th>
                  <th>Routes</th>
                  <th>Dates</th>
                  <th>Status</th>
                  <th>Path</th>
                  <th>Readiness</th>
                  <th>Next owner</th>
                  <th>Communications</th>
                  <th>Workflow</th>
                  {reportingReady ? <th>Reason</th> : null}
                  {reportingReady ? <th>Severity</th> : null}
                  <th>Created by</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((d) => (
                  <Fragment key={d.id}>
                    <tr style={{ cursor: "pointer" }} onClick={() => setExpandedId(expandedId === d.id ? null : d.id)}>
                      <td>{d.internal_number || "—"}</td>
                      <td>{d.number || "—"}</td>
                      <td>{d.closure}</td>
                      <td className="td-dim">{d.segments.map((s) => s.routes).join("; ") || "—"}</td>
                      <td className="td-dim">{dateLabel(d.start_date)} – {dateLabel(d.end_date)}</td>
                      <td><span className={`pill-sm ${STATUS_PILL[d.status]}`}>{DETOUR_STATUS_LABELS[d.status]}</span></td>
                      <td className="td-dim">{fulfillmentPathLabel(d)}</td>
                      <td className="td-dim">{readinessLabel(d)}</td>
                      <td className="td-dim">{d.workflow_owner || "Unassigned"}</td>
                      <td className="td-dim">{communicationStatusLabel(d)}</td>
                      <td className="td-dim">{workflowLabel(d)}</td>
                      {reportingReady ? <td className="td-dim">{reasonLabelOf(d.reason_code)}</td> : null}
                      {reportingReady ? (
                        <td className="td-dim">{d.severity ? DETOUR_SEVERITY_LABELS[d.severity] : "—"}</td>
                      ) : null}
                      <td className="td-dim">{createdByLabel(d)}</td>
                      <td className="td-dim">{sourceLabel(d)}</td>
                    </tr>
                    {expandedId === d.id ? (
                      <tr>
                        <td colSpan={reportingReady ? 15 : 13}>
                          <div className="subcard" style={{ margin: "4px 0" }}>
                            <DetourOperationalRecord detour={d} />
                            {d.riders_directed ? <p><b>Riders directed:</b> {d.riders_directed}</p> : null}
                            {d.segments.length === 0 ? (
                              <p className="muted">No route segments recorded.</p>
                            ) : (
                              <table className="data">
                                <thead><tr><th>Routes</th><th>Directions</th></tr></thead>
                                <tbody>
                                  {d.segments.map((s) => (
                                    <tr key={s.id}><td>{s.routes}</td><td className="td-dim">{s.directions || "—"}</td></tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                            {/* Rendered only when something was actually
                                recorded - a line of bare dashes was noise
                                that pushed the useful provenance down the
                                panel. */}
                            {d.reported_by || d.reported_at ? (
                              <p className="td-dim" style={{ marginTop: 8 }}>
                                Reported by {d.reported_by || "—"}
                                {d.reported_at ? ` · ${dateTimeLabel(d.reported_at)}` : ""}
                              </p>
                            ) : null}
                            {d.approved_by || d.approved_at ? (
                              <p className="td-dim">
                                Approved by {d.approved_by || "—"}
                                {d.approved_at ? ` · ${dateTimeLabel(d.approved_at)}` : ""}
                              </p>
                            ) : null}
                            {d.resolution_notes ? <p><b>Resolution:</b> {d.resolution_notes}</p> : null}
                            {d.closure_reason ? <p><b>Closure reason:</b> {d.closure_reason}</p> : null}
                            {d.fulfillment_mode === "avail" ? (
                              <p className="td-dim"><b>Avail:</b> {availEntryLabel(d)}
                                {d.external_detour_id ? ` · ID ${d.external_detour_id}` : ""}
                                {d.avail_last_seen_at ? ` · Last seen ${dateTimeLabel(d.avail_last_seen_at)}` : ""}
                              </p>
                            ) : null}
                            <p className="td-dim" style={{ marginTop: 8 }}>
                              Notified — Email: {d.email_sent ? "Yes" : "No"} · Expired email:{" "}
                              {d.expired_email_sent ? "Yes" : "No"} · Spare: {d.spare_emailed ? "Yes" : "No"}
                              {reportingReady ? (
                                <>
                                  {" · "}Radio: {d.radio_notified ? "Yes" : "No"} · Dispatch board:{" "}
                                  {d.dispatch_board_notified ? "Yes" : "No"} · Social media:{" "}
                                  {d.social_media_notified ? "Yes" : "No"}
                                </>
                              ) : null}
                            </p>
                            <p className="td-dim">
                              Created by {createdByLabel(d)} on{" "}
                              {dateTimeLabel(d.created_at)}
                              {d.updated_by ? ` · Last edited by ${d.updated_by} on ${dateTimeLabel(d.updated_at)}` : ""}
                            </p>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
