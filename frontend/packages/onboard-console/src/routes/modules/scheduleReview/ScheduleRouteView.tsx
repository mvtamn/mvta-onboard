import { useEffect, useState } from "react";
import { ApiError, type RouteCheckDetail, type RouteScheduleDetailResponse, type TimepointSegmentDetail } from "@mvta/shared";
import { api } from "../../../config.js";
import { whenLabel } from "../kpiTrustPresentation.js";
import { OWNER_LABEL, feedSentence, formatRiskValue, thresholdSentence } from "../scheduleReviewPresentation.js";
import { ObservedGrid } from "./ObservedGrid.js";
import "./scheduleReview.css";

// One route's schedule review: what in the published schedule makes its
// predictions worse, the evidence behind each flag, who owns the fix, and the
// scheduled minutes over each timepoint segment by start hour. Analysis of the
// static GTFS review (lib/scheduleReview, ADR 0040), not compliance: it reads
// no OTP figure and changes nothing. Hand-rolled tables, no chart dependency.

type Load =
  | { state: "loading" }
  | { state: "ready"; detail: RouteScheduleDetailResponse }
  | { state: "error"; message: string };

/** Evidence rows shown before "show all"; the rest are one click away. */
const FIRST_SHOWN = 6;

function errorMessage(error: unknown, routeLabel: string): string {
  if (error instanceof ApiError && error.status === 503) {
    return "The database is missing migration 145, so the evidence behind the schedule review is not kept. Run sql/migration-145-schedule-review-route-detail.sql.";
  }
  if (error instanceof ApiError && error.status === 404) {
    return `The latest schedule review has no detail for route ${routeLabel}. Either the route is not in the published feed, or the review predates migration 145 and the next static GTFS import will keep it.`;
  }
  if (error instanceof ApiError && error.status === 401) return "Sign in again to see the schedule review.";
  return "The schedule review could not be loaded. Try again shortly.";
}

function hourLabel(hour: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}${hour < 12 ? "a" : "p"}`;
}

/** Every start hour any segment has trips in, so the grid's columns line up. */
export function gridHours(segments: TimepointSegmentDetail[]): number[] {
  return [...new Set(segments.flatMap((s) => s.hours.map((h) => h.hour)))].sort((a, b) => a - b);
}

/** The same hours the review's run-time check calls the peak (lib/scheduleReview/feedModel PEAK_HOURS). */
const PEAK_HOURS = new Set([6, 7, 8, 9, 15, 16, 17, 18]);

/**
 * A segment given the same minutes in every hour it runs, across both the peak
 * and the off-peak: the day the schedule says never changes. A segment that
 * only runs in the peak (an express route's three morning trips) has nothing
 * to differ from and is not marked.
 */
export function isFlatSegment(segment: TimepointSegmentDetail): boolean {
  if (segment.hours.length < 3) return false;
  const spansPeak = segment.hours.some((h) => PEAK_HOURS.has(h.hour));
  const spansOffPeak = segment.hours.some((h) => !PEAK_HOURS.has(h.hour));
  if (!spansPeak || !spansOffPeak) return false;
  const first = segment.hours[0];
  return segment.hours.every((h) => h.min_minutes === first.min_minutes && h.max_minutes === first.min_minutes);
}

function cellText(hour: TimepointSegmentDetail["hours"][number]): string {
  return hour.min_minutes === hour.max_minutes ? String(hour.min_minutes) : `${hour.min_minutes}–${hour.max_minutes}`;
}

function Check({
  check,
  definition,
  showAll,
  onShowAll,
}: {
  check: RouteCheckDetail;
  definition: RouteScheduleDetailResponse["checks"][number];
  showAll: boolean;
  onShowAll: () => void;
}) {
  const value = formatRiskValue(definition, check.value);
  const rows = showAll ? check.evidence : check.evidence.slice(0, FIRST_SHOWN);
  return (
    <li className={`sr-check${check.flagged ? " flagged" : ""}${check.value === null ? " unmeasured" : ""}`}>
      <details open={check.flagged}>
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
        {check.evidence.length > FIRST_SHOWN && !showAll ? (
          <button type="button" className="sr-btn" onClick={onShowAll}>Show all {check.evidence.length} rows</button>
        ) : null}
      </details>
    </li>
  );
}

export function ScheduleRouteView({ routeId, routeLabel, onClose }: { routeId: string; routeLabel: string; onClose: () => void }) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let live = true;
    setLoad({ state: "loading" });
    setExpanded(new Set());
    api.getGtfsPredictionRiskRoute(routeId)
      .then((detail) => { if (live) setLoad({ state: "ready", detail }); })
      .catch((error: unknown) => { if (live) setLoad({ state: "error", message: errorMessage(error, routeLabel) }); });
    return () => { live = false; };
  }, [routeId, routeLabel]);

  const detail = load.state === "ready" ? load.detail : null;
  const route = detail?.route ?? null;
  // Flagged first, then measured, then what the route had nothing to measure for.
  const checks = route
    ? [...route.checks].sort((a, b) =>
      Number(b.flagged) - Number(a.flagged) || Number(a.value === null) - Number(b.value === null))
    : [];
  const definitionOf = (id: string) => detail?.checks.find((c) => c.id === id);
  const hours = route ? gridHours(route.segments) : [];

  return (
    <section className="sr-panel" aria-labelledby="sr-route-heading">
      <div className="sr-panel-head">
        <h3 id="sr-route-heading">
          <span className="sr-route-chip">Route {routeLabel}</span>
          Schedule review
          {detail ? <span className="sr-muted"> · {feedSentence(detail.feed)}</span> : null}
        </h3>
        <button type="button" className="sr-btn" onClick={onClose}>Close</button>
      </div>

      {load.state === "loading" ? <p className="sr-muted">Loading the schedule review…</p> : null}
      {load.state === "error" ? <p className="sr-error" role="alert">{load.message}</p> : null}

      {detail && route ? (
        <>
          <p className="sr-meta">
            {route.trip_count.toLocaleString()} trips · {route.stop_count} stops · {route.timepoint_count} timepoints · {route.pattern_count} stop {route.pattern_count === 1 ? "pattern" : "patterns"}
            {" · "}{route.flag_count === 0 ? "nothing flagged" : `${route.flag_count} flagged`}
            {" · reviewed "}{whenLabel(detail.reviewed_at)}
            {detail.confirmed_at ? `, confirmed ${whenLabel(detail.confirmed_at)}` : ""}
          </p>

          <ol className="sr-checks" aria-label={`Route ${routeLabel} schedule checks, flagged first`}>
            {checks.map((check) => {
              const definition = definitionOf(check.id);
              if (!definition) return null;
              return (
                <Check
                  key={check.id}
                  check={check}
                  definition={definition}
                  showAll={expanded.has(check.id)}
                  onShowAll={() => setExpanded((prev) => new Set(prev).add(check.id))}
                />
              );
            })}
          </ol>

          {route.segments.length > 0 ? (
            <>
              <h4 className="sr-grid-title">Scheduled minutes between timepoints, by the hour the trip starts</h4>
              <div className="sr-scroll">
                <table className="sr-grid" aria-label={`Route ${routeLabel} scheduled minutes per timepoint segment by start hour`}>
                  <thead>
                    <tr>
                      <th scope="col">Segment</th>
                      <th scope="col" className="num">Miles</th>
                      {hours.map((hour) => <th scope="col" className="num" key={hour}>{hourLabel(hour)}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {route.segments.map((segment) => {
                      const flat = isFlatSegment(segment);
                      const byHour = new Map(segment.hours.map((h) => [h.hour, h]));
                      return (
                        <tr key={`${segment.from_stop_id}-${segment.to_stop_id}`} className={flat ? "flat" : undefined}>
                          <th scope="row">
                            <span className="sr-seg">{segment.from_stop_name} → {segment.to_stop_name}</span>
                            {flat ? <span className="sr-flat" title="The same scheduled minutes in every hour it runs, peak and off-peak">same all day</span> : null}
                          </th>
                          <td className="num sr-muted">{segment.miles === null ? "—" : segment.miles}</td>
                          {hours.map((hour) => {
                            const cell = byHour.get(hour);
                            return (
                              <td className="num" key={hour} title={cell ? `${cell.trips} ${cell.trips === 1 ? "trip" : "trips"}` : undefined}>
                                {cell ? cellText(cell) : <span className="sr-muted">·</span>}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="sr-foot">
                A cell is the scheduled running time over that segment for trips starting in that hour; a range means the trips differ. A row marked "same all day" is given the same minutes in the peak and the off-peak: a schedule that says traffic never changes. Miles are along the route where the feed's shape distances allow.
              </p>
            </>
          ) : null}

          <ObservedGrid routeId={route.route_id} routeLabel={routeLabel} hours={hours} />
        </>
      ) : null}
    </section>
  );
}
