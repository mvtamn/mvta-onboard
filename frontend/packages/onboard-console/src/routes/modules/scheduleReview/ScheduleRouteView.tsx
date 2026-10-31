import { useContext, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ApiError,
  type ObservedDayKind,
  type ObservedOtpResponse,
  type ObservedReading,
  type PredictionRiskCheckDefinition,
  type PredictionRiskOwner,
  type RouteCheckDetail,
  type RouteScheduleDetailResponse,
} from "@mvta/shared";
import { api } from "../../../config.js";
import { AccessContext } from "../../../auth/AccessContext.js";
import { whenLabel } from "../kpiTrustPresentation.js";
import { OWNER_LABEL, feedDate, feedSentence, formatRiskValue, thresholdSentence } from "../scheduleReviewPresentation.js";
import { DirectionGrid } from "./DirectionGrid.js";
import "./scheduleReview.css";

// One route on the Schedule Review page (redesign, design canvas "Main"):
// what Avail confirms first, then schedule and street in one grid per
// direction, then every check grouped by who can fix it, each with its
// evidence. Analysis of the published schedule, not compliance: nothing here
// is an official OTP figure and nothing changes.

type Load<T> = { state: "loading" } | { state: "ready"; data: T } | { state: "error"; message: string };

const WINDOWS = [7, 28, 90] as const;
type WindowDays = (typeof WINDOWS)[number];
const DAYS: { key: ObservedDayKind; label: string }[] = [
  { key: "weekday", label: "Weekdays" },
  { key: "saturday", label: "Saturdays" },
  { key: "sunday", label: "Sundays" },
];

/** Evidence rows and readings shown before "Show all". */
const FIRST_SHOWN = 6;
const READINGS_SHOWN = 4;

const OWNER_ORDER: PredictionRiskOwner[] = ["scheduling", "avail", "operations", "structural"];

function detailError(error: unknown, routeLabel: string): string {
  if (error instanceof ApiError && error.status === 404) {
    return `The latest schedule review has no detail for route ${routeLabel}. The route is not in the published feed.`;
  }
  if (error instanceof ApiError && error.status === 401) return "Sign in again to see the schedule review.";
  return "The schedule review could not be loaded.";
}

function observedError(error: unknown, dow: ObservedDayKind, days: number): string {
  if (error instanceof ApiError && error.status === 404) {
    const kind = dow === "weekday" ? "weekdays" : dow === "saturday" ? "Saturdays" : "Sundays";
    return `Avail has nothing for this route on ${kind} in the last ${days} days. It may not run then.`;
  }
  if (error instanceof ApiError && error.status === 403) return "What Avail observed needs Compliance access.";
  return "What Avail observed could not be loaded.";
}

function windowSentence(observed: ObservedOtpResponse): string {
  const { window } = observed;
  const kind = window.dow === "weekday" ? "weekdays" : window.dow === "saturday" ? "Saturdays" : "Sundays";
  const from = feedDate(window.first_day);
  const to = feedDate(window.last_day);
  return `${window.service_days} ${kind}${from && to ? ` ${from} to ${to}` : ""}, ${observed.departures.toLocaleString()} departures`;
}

function readingTitle(reading: ObservedReading): string {
  const way = reading.direction ? ({ N: "northbound", S: "southbound", E: "eastbound", W: "westbound" } as Record<string, string>)[reading.direction] ?? reading.direction : null;
  const kind = reading.kind === "off_peak_over_run" ? "Midday over-run" : reading.period === "am" ? "AM peak under-run" : "PM peak under-run";
  return way ? `${kind} · ${way}` : kind;
}

/** The text "Copy evidence for scheduling" puts on the clipboard. Exported for its test. */
export function evidenceText(detail: RouteScheduleDetailResponse, readings: ObservedReading[], windowText: string | null): string {
  const { route, checks } = detail;
  const name = detail.route_long_name ? ` (${detail.route_long_name})` : "";
  const lines = [`Route ${route.route_short_name}${name}: schedule review of feed ${detail.feed.version ?? "(no version)"}`];
  if (readings.length > 0) {
    lines.push("", `Confirmed by Avail${windowText ? `, ${windowText}` : ""}:`);
    for (const r of readings) lines.push(`- ${r.text}`);
  }
  const flagged = route.checks.filter((c) => c.flagged);
  if (flagged.length > 0) {
    lines.push("", "Flagged checks:");
    for (const c of flagged) {
      const def = checks.find((d) => d.id === c.id);
      if (!def) continue;
      lines.push(`- ${def.label}: ${formatRiskValue(def, c.value)} (${thresholdSentence(def)}). ${OWNER_LABEL[def.owner]}: ${def.fix}`);
      for (const e of c.evidence.slice(0, FIRST_SHOWN)) lines.push(`    ${e.text}`);
    }
  }
  return lines.join("\n");
}

function CheckRow({ check, definition }: { check: RouteCheckDetail; definition: PredictionRiskCheckDefinition }) {
  const [all, setAll] = useState(false);
  const value = formatRiskValue(definition, check.value);
  const rows = all ? check.evidence : check.evidence.slice(0, FIRST_SHOWN);
  const state = check.flagged ? "flagged" : check.value === null ? "unmeasured" : "clear";
  return (
    <li className={`sr-check ${state}`}>
      <details open={check.flagged && definition.owner !== "structural"}>
        <summary aria-label={`${definition.label}: ${value}${check.flagged ? ", flagged" : check.value === null ? ", not measured" : ""}`}>
          <span className="sr-value">{value}</span>
          <span className="sr-label">{definition.label}</span>
          {check.flagged ? <span className="sr-flag">Flagged</span> : null}
          <span className="sr-threshold">{check.value === null ? "nothing to measure" : thresholdSentence(definition)}</span>
        </summary>
        <p className="sr-why">{definition.why}</p>
        <p className="sr-fix"><strong>{OWNER_LABEL[definition.owner]}:</strong> {definition.fix}</p>
        {check.evidence.length > 0 ? (
          <ul className="sr-evidence" aria-label={`${definition.label} evidence`}>
            {rows.map((row, i) => <li key={i}>{row.text}</li>)}
          </ul>
        ) : null}
        {check.evidence.length > FIRST_SHOWN ? (
          <button type="button" className="sr-btn" aria-expanded={all} onClick={() => setAll((v) => !v)}>
            {all ? "Show fewer" : `Show all ${check.evidence.length} rows`}
          </button>
        ) : null}
      </details>
    </li>
  );
}

export function ScheduleRouteView({ routeId, routeLabel, focusOnLoad = false }: { routeId: string; routeLabel: string; focusOnLoad?: boolean }) {
  const access = useContext(AccessContext);
  const canSeeObserved = access?.can("compliance-review.view") ?? false;
  const [detail, setDetail] = useState<Load<RouteScheduleDetailResponse>>({ state: "loading" });
  const [detailTry, setDetailTry] = useState(0);
  const [days, setDays] = useState<WindowDays>(28);
  const [dow, setDow] = useState<ObservedDayKind>("weekday");
  const [observed, setObserved] = useState<Load<ObservedOtpResponse>>({ state: "loading" });
  const [refetching, setRefetching] = useState(false);
  const [observedTry, setObservedTry] = useState(0);
  const [allReadings, setAllReadings] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let live = true;
    setDetail({ state: "loading" });
    setAllReadings(false);
    setCopied(null);
    api.getGtfsPredictionRiskRoute(routeId)
      .then((data) => { if (live) setDetail({ state: "ready", data }); })
      .catch((error: unknown) => { if (live) setDetail({ state: "error", message: detailError(error, routeLabel) }); });
    return () => { live = false; };
  }, [routeId, routeLabel, detailTry]);

  // Opening a route from the list moves focus (and the screen) to it.
  useEffect(() => {
    if (focusOnLoad && detail.state !== "loading") heading.current?.focus();
  }, [focusOnLoad, detail.state, routeId]);

  useEffect(() => {
    if (!canSeeObserved) return;
    let live = true;
    // Keep the last grid on screen while a new window loads, quieter.
    setRefetching(true);
    api.getGtfsPredictionRiskRouteObserved(routeId, { days, dow })
      .then((data) => { if (live) setObserved({ state: "ready", data }); })
      .catch((error: unknown) => { if (live) setObserved({ state: "error", message: observedError(error, dow, days) }); })
      .finally(() => { if (live) setRefetching(false); });
    return () => { live = false; };
  }, [canSeeObserved, routeId, days, dow, observedTry]);

  useEffect(() => { setObserved({ state: "loading" }); }, [routeId]);

  if (detail.state === "loading") return <section className="sr-detail" aria-busy="true"><p className="sr-muted">Loading route {routeLabel}…</p></section>;
  if (detail.state === "error") {
    return (
      <section className="sr-detail">
        <div className="sr-card">
          <h2 ref={heading} tabIndex={-1} className="sr-route-title"><span className="sr-route-chip">{routeLabel}</span></h2>
          <p className="sr-error" role="alert">{detail.message}</p>
          <button type="button" className="sr-btn" onClick={() => setDetailTry((n) => n + 1)}>Try again</button>
        </div>
      </section>
    );
  }

  const data = detail.data;
  const route = data.route;
  const observedData = observed.state === "ready" ? observed.data : null;
  const readings = observedData?.readings ?? [];
  const sortedReadings = [...readings].sort((a, b) => (b.peak_pct - b.off_peak_pct) - (a.peak_pct - a.off_peak_pct));
  const shownReadings = allReadings ? sortedReadings : sortedReadings.slice(0, READINGS_SHOWN);
  const fixable = route.checks.filter((c) => c.flagged && data.checks.find((d) => d.id === c.id)?.owner !== "structural").length;
  const windowText = observedData ? windowSentence(observedData) : null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(evidenceText(data, sortedReadings, windowText));
      setCopied("Copied. Paste it into the email to scheduling or Avail.");
    } catch {
      setCopied("Your browser did not allow copying. Select the evidence on the page instead.");
    }
  };

  const groups = OWNER_ORDER.map((owner) => {
    const defs = data.checks.filter((d) => d.owner === owner);
    const rows = route.checks
      .filter((c) => defs.some((d) => d.id === c.id))
      .sort((a, b) => Number(b.flagged) - Number(a.flagged) || Number(a.value === null) - Number(b.value === null));
    return { owner, rows, flagged: rows.filter((r) => r.flagged).length };
  }).filter((g) => g.rows.length > 0);

  return (
    <section className="sr-detail" aria-labelledby={`sr-route-${route.route_id}`}>
      <div className="sr-card sr-route-head">
        <div className="sr-route-head-row">
          <h2 id={`sr-route-${route.route_id}`} ref={heading} tabIndex={-1} className="sr-route-title">
            <span className="sr-route-chip">{route.route_short_name}</span>
            {data.route_long_name ?? `Route ${route.route_short_name}`}
          </h2>
          <div className="sr-actions">
            <button type="button" className="sr-btn" onClick={copy}>Copy evidence for scheduling</button>
            <Link className="sr-btn" to={{ search: `?route=${encodeURIComponent(route.route_id)}` }}>Link to this route</Link>
          </div>
        </div>
        <p className="sr-meta">
          {route.trip_count.toLocaleString()} trips · {route.stop_count} stops · {route.timepoint_count} timepoints · {route.pattern_count} stop {route.pattern_count === 1 ? "pattern" : "patterns"} ·{" "}
          <strong className={fixable > 0 ? "sr-warn" : undefined}>{fixable} fixable {fixable === 1 ? "flag" : "flags"}</strong>
          {observedData ? <> · <strong>{new Set(readings.map((r) => `${r.from_stop_id}-${r.to_stop_id}`)).size} confirmed by Avail</strong></> : null}
        </p>
        <p className="sr-meta">{feedSentence(data.feed)} · reviewed {whenLabel(data.reviewed_at)}</p>
        {copied ? <p className="sr-meta" role="status">{copied}</p> : null}
      </div>

      <div className="sr-card">
        <div className="sr-card-head">
          <h3>What Avail confirms</h3>
          {canSeeObserved ? (
            <div className="sr-controls">
              <div className="sr-seg-ctl" role="group" aria-label="Window">
                {WINDOWS.map((w) => <button key={w} type="button" aria-pressed={days === w} onClick={() => setDays(w)}>{w} days</button>)}
              </div>
              <div className="sr-seg-ctl" role="group" aria-label="Service days">
                {DAYS.map((d) => <button key={d.key} type="button" aria-pressed={dow === d.key} onClick={() => setDow(d.key)}>{d.label}</button>)}
              </div>
            </div>
          ) : null}
        </div>
        {!canSeeObserved ? (
          <p className="sr-muted">Comparing the schedule with what Avail observed needs Compliance access, because it reads OTP data.</p>
        ) : observed.state === "loading" ? (
          <p className="sr-muted">Loading what Avail observed…</p>
        ) : observed.state === "error" ? (
          <div className="sr-inline-error">
            <p className="sr-error" role="alert">{observed.message}</p>
            <button type="button" className="sr-btn" onClick={() => setObservedTry((n) => n + 1)}>Try again</button>
          </div>
        ) : sortedReadings.length === 0 ? (
          <p className="sr-muted">
            {observed.data.schedule_available
              ? "Avail does not confirm a schedule problem here: no segment scheduled the same all day runs late in a peak, or early at midday, beyond the rule. The grid below still shows every hour."
              : "The schedule's evidence for this route is not kept yet (migration 145), so nothing is read against it."}
          </p>
        ) : (
          <>
            <ul className={`sr-readings${refetching ? " dimmed" : ""}`} aria-label={`Route ${route.route_short_name}: where Avail confirms a schedule problem`}>
              {shownReadings.map((r) => (
                <li key={`${r.from_stop_id}-${r.to_stop_id}-${r.period}`}>
                  <span className="sr-reading-kind">{readingTitle(r)}</span>
                  <span className="sr-reading-where">{r.from_stop_name} to {r.to_stop_name}</span>
                  <span>{r.text}</span>
                </li>
              ))}
            </ul>
            {sortedReadings.length > READINGS_SHOWN ? (
              <button type="button" className="sr-btn" aria-expanded={allReadings} onClick={() => setAllReadings((v) => !v)}>
                {allReadings ? "Show fewer" : `Show all ${sortedReadings.length} readings`}
              </button>
            ) : null}
          </>
        )}
        {windowText ? <p className="sr-foot">Avail's own early, on-time and late counts, {windowText}. Not the official OTP figure.</p> : null}
      </div>

      {route.segments.length > 0 ? (
        <div className="sr-card">
          <h3>Running time by hour: what the schedule says, and what Avail saw</h3>
          <DirectionGrid
            routeLabel={route.route_short_name}
            segments={route.segments}
            timepoints={observedData?.timepoints ?? null}
            readings={readings}
            windowSentence={windowText}
            dimmed={refetching}
          />
        </div>
      ) : null}

      <div className="sr-card">
        <h3>Schedule checks, by who can fix them</h3>
        {groups.map((g) => (
          <div key={g.owner} className={`sr-owner ${g.flagged > 0 ? "has-flags" : ""}`}>
            <h4>{OWNER_LABEL[g.owner]} · {g.flagged === 0 ? "none flagged" : `${g.flagged} flagged`}</h4>
            <ol className="sr-checks">
              {g.rows.map((check) => {
                const definition = data.checks.find((d) => d.id === check.id);
                return definition ? <CheckRow key={check.id} check={check} definition={definition} /> : null;
              })}
            </ol>
          </div>
        ))}
      </div>
    </section>
  );
}
