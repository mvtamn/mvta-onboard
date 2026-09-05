import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, type TripStartLogDiagnostics, type TripStartLogTrip } from "@mvta/shared";
import { api } from "../../../config.js";
import { formatRefreshCountdown, useFixedRouteRefresh } from "../../../context/FixedRouteRefreshContext.js";
import { TripStartLogInspector } from "./TripStartLogInspector.js";
import { TripStartLogQueryBar } from "./TripStartLogQueryBar.js";
import { TripStartLogSummary } from "./TripStartLogSummary.js";
import { TripStartLogGrid } from "./TripStartLogGrid.js";
import { TripStartLogTimeline } from "./TripStartLogTimeline.js";
import { TripStartLogWatch } from "./TripStartLogWatch.js";
import { useNow } from "./useNow.js";
import {
  EMPTY_FILTERS,
  TRIP_START_VIEWS,
  agencyTodayServiceDate,
  applyFilters,
  filtersActive,
  inputToServiceDate,
  routeOptions,
  serviceDateLabel,
  serviceDateToInput,
  sortTrips,
  summarize,
  type SortDir,
  type SortKey,
  type TripStartFilters,
  type TripStartView,
} from "./tripStartLogState.js";
import "../serviceRisk.css";
import "./tripStartLog.css";

type LoadState = "loading" | "unavailable" | "not_connected" | "not_materialized" | "live";

function loadState(diagnostics: TripStartLogDiagnostics | null, loading: boolean, failed: boolean): LoadState {
  if (loading && !diagnostics) return "loading";
  if (failed || !diagnostics) return "unavailable";
  if (!diagnostics.table_ready) return "not_connected";
  if (!diagnostics.materialized) return "not_materialized";
  return "live";
}

function dowOf(serviceDate: string): string | null {
  const input = serviceDateToInput(serviceDate);
  if (!input) return null;
  const date = new Date(`${input}T12:00:00Z`);
  return ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][date.getUTCDay()] ?? null;
}

// Dispatch Log - the OCS desk's record of whether each revenue trip started
// on time, over data OnBoard already collects (plans/dispatch-log-spec.md).
// This is the module shell: one query, one piece of state, and the pieces
// every view shares - query bar, summary strip, view switcher, selection and
// the inspector. The views themselves are later build steps and inherit all
// of this rather than re-implementing it.
export function TripStartLog() {
  // The date the desk asked for (null = today, agency-local, which the API
  // resolves) and the date the current rows are for. Kept apart so a response
  // filling in "today" never re-triggers the load that produced it.
  const [dateChoice, setDateChoice] = useState<string | null>(null);
  const [serviceDate, setServiceDate] = useState<string | null>(null);
  const [trips, setTrips] = useState<TripStartLogTrip[]>([]);
  const [diagnostics, setDiagnostics] = useState<TripStartLogDiagnostics | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const [view, setView] = useState<TripStartView>("grid");
  const [filters, setFilters] = useState<TripStartFilters>(EMPTY_FILTERS);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  // Sort state lives in the shell: the Grid owns the header UI, the shell
  // owns the order every view reads. Default is the workbook's - scheduled
  // start ascending.
  const [sortKey, setSortKey] = useState<SortKey>("scheduled");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const refresh = useFixedRouteRefresh();
  const requestedDate = useRef<string | null>(null);
  // The Watch queue and the Timeline's marker share one clock. It only ticks
  // while the day on screen is today; "now" means nothing on another date.
  const isToday = serviceDate !== null && serviceDate === agencyTodayServiceDate(new Date());
  const now = useNow(isToday ? 30_000 : null);

  function load(date: string | null, quiet = false) {
    if (!quiet) setLoading(true);
    requestedDate.current = date;
    api
      .getTripStartLog(date ?? undefined)
      .then((response) => {
        // A slower response for an earlier date must not overwrite a newer one.
        if (requestedDate.current !== date) return;
        setTrips(response.trips);
        setDiagnostics(response.diagnostics);
        setServiceDate(response.service_date);
        setFailed(false);
        setMessage(
          !response.diagnostics.table_ready
            ? "The Dispatch Log is not connected: its tables are missing, so no day has been built yet. Apply migration 094."
            : !response.diagnostics.materialized
              ? `No log exists for ${serviceDateLabel(response.service_date)}. The nightly build runs at 09:30 UTC for today and tomorrow; a day with no scheduled service, or one before the log started, has no rows.`
              : null,
        );
      })
      .catch((err) => {
        if (requestedDate.current !== date) return;
        setFailed(true);
        setMessage(
          err instanceof ApiError
            ? `Could not load the Dispatch Log: ${err.message}`
            : "Could not reach the trip-start log service.",
        );
      })
      .finally(() => {
        if (requestedDate.current === date) setLoading(false);
      });
  }

  useEffect(() => {
    load(dateChoice);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateChoice]);

  // Live refresh on the fixed-route cadence (spec §4.3): each completed tick
  // of the shared refresh context re-reads the day quietly, so the desk's
  // view moves with the actuals without a spinner over the table.
  const lastTick = refresh.lastCompletedAt?.getTime() ?? null;
  const seenTick = useRef(lastTick);
  useEffect(() => {
    if (lastTick === null || lastTick === seenTick.current) return;
    seenTick.current = lastTick;
    if (diagnostics) load(dateChoice, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastTick]);

  const state = loadState(diagnostics, loading, failed);
  const live = state === "live";

  // The whole day as the API writes it, not the filtered view: the export
  // stands in for the workbook, and the workbook was the whole day.
  async function exportCsv() {
    if (!serviceDate) return;
    setExporting(true);
    setExportError(null);
    try {
      const blob = await api.getTripStartLogCsv(serviceDate);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `dispatch-log-${serviceDate}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof ApiError ? `Export failed: ${err.message}` : "Export failed: the trip-start log service could not be reached.");
    } finally {
      setExporting(false);
    }
  }

  const routes = useMemo(() => routeOptions(trips), [trips]);
  const filtered = useMemo(() => sortTrips(applyFilters(trips, filters), sortKey, sortDir), [trips, filters, sortKey, sortDir]);
  const summary = useMemo(() => summarize(filtered), [filtered]);
  const selected = useMemo(() => trips.find((t) => t.trip_id === selectedTripId) ?? null, [trips, selectedTripId]);
  const serviceDow = serviceDate ? dowOf(serviceDate) : null;

  return (
    <div className="risk-module tsl-module">
      <div className="risk-module-head">
        <div>
          <span className="risk-eyebrow">Live monitoring</span>
          <h2>Dispatch Log</h2>
          <p>
            Every revenue trip scheduled for the day with its actual start beside the schedule, and the
            weekly verification rotation that says which trips the desk owes initials on. Rows outside
            today's rotation stay visible, dimmed.
          </p>
        </div>
      </div>

      <div className="risk-refresh-bar tsl-controls" aria-label="Dispatch log controls">
        <label className="tsl-date-label" htmlFor="tsl-date">Service date</label>
        <input
          id="tsl-date"
          className="tsl-date"
          type="date"
          value={serviceDateToInput(dateChoice ?? serviceDate ?? "")}
          onChange={(e) => {
            const next = inputToServiceDate(e.target.value);
            if (next) {
              setSelectedTripId(null);
              setDateChoice(next);
            }
          }}
        />
        <span className="risk-refresh-countdown">
          {refresh.lastCompletedAt
            ? `Refreshes with fixed-route data · next in ${formatRefreshCountdown(refresh.secondsLeft)}`
            : "Refreshes with fixed-route data"}
        </span>
        <button className="btn-sm" disabled={loading} onClick={() => load(dateChoice)}>
          {loading ? "Refreshing…" : "↻ Refresh"}
        </button>
        <button
          className="btn-sm"
          disabled={!live || exporting}
          title={live ? "Download the whole day as a CSV workbook" : "Available once the day's log exists"}
          onClick={() => void exportCsv()}
        >
          {exporting ? "Exporting…" : "⬇ Export CSV"}
        </button>
      </div>

      {exportError ? (
        <div className="concept-banner" role="alert">
          <span className="concept-badge">Export</span>
          <span>{exportError}</span>
        </div>
      ) : null}

      {message ? (
        <div className="concept-banner" role="status">
          <span className="concept-badge">{state === "live" ? "Live data" : state === "loading" ? "Checking" : state === "unavailable" ? "Unavailable" : "Not connected"}</span>
          <span>{message}</span>
        </div>
      ) : null}

      <TripStartLogQueryBar filters={filters} routes={routes} onChange={setFilters} />
      <TripStartLogSummary summary={live ? summary : null} live={live} />

      <div className="tsl-views" role="tablist" aria-label="Dispatch log views">
        {TRIP_START_VIEWS.map((v) => (
          <button
            key={v.key}
            role="tab"
            aria-selected={view === v.key}
            className={view === v.key ? "active" : ""}
            onClick={() => setView(v.key)}
          >
            {v.label}
          </button>
        ))}
        {live ? (
          <span className="tsl-views-count">
            {filtered.length} of {trips.length} trips{filtersActive(filters) ? " match" : ""} · {diagnostics?.rotation_count ?? 0} on today's rotation
          </span>
        ) : null}
      </div>

      <div role="tabpanel" aria-label={`${TRIP_START_VIEWS.find((v) => v.key === view)?.label ?? ""} view`}>
        {state === "loading" ? (
          <div className="risk-empty-state" role="status">
            <strong>Loading the Dispatch Log</strong>
            <span>Reading the day's scheduled revenue trips.</span>
          </div>
        ) : state === "unavailable" ? (
          <div className="risk-empty-state">
            <strong>Dispatch Log unavailable</strong>
            <span>The trip-start log service could not be reached, so this day cannot be shown.</span>
          </div>
        ) : state === "not_connected" ? (
          <div className="risk-empty-state">
            <strong>Dispatch Log is not connected</strong>
            <span>The log's tables are missing, so no day has been built to show.</span>
          </div>
        ) : state === "not_materialized" ? (
          <div className="risk-empty-state">
            <strong>No log for this date</strong>
            <span>Pick another service date, or wait for the nightly build.</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="risk-empty-state">
            <strong>No trips match</strong>
            <span>
              {filters.rotationOnly && !filtersActive({ ...filters, rotationOnly: false })
                ? "No trip on today's rotation matches. Switch to All trips to see the whole day."
                : "Clear a filter to widen the day."}
            </span>
          </div>
        ) : (
          view === "watch" ? (
          <TripStartLogWatch
            trips={filtered}
            serviceDate={serviceDate ?? ""}
            now={now}
            isToday={isToday}
            selectedTripId={selectedTripId}
            onSelect={setSelectedTripId}
          />
        ) : view === "timeline" ? (
          <TripStartLogTimeline
            trips={filtered}
            now={isToday ? now : null}
            selectedTripId={selectedTripId}
            onSelect={setSelectedTripId}
          />
        ) : (
          <TripStartLogGrid
            trips={filtered}
            sortKey={sortKey}
            sortDir={sortDir}
            onSortChange={(key, dir) => { setSortKey(key); setSortDir(dir); }}
            selectedTripId={selectedTripId}
            onSelect={setSelectedTripId}
          />
        )
        )}
      </div>

      <TripStartLogInspector trip={selected} serviceDow={serviceDow} />
    </div>
  );
}
