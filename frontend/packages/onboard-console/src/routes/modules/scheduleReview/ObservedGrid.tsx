import { useContext, useEffect, useState } from "react";
import { ApiError, type ObservedCell, type ObservedDayKind, type ObservedOtpResponse, type ObservedReading } from "@mvta/shared";
import { api } from "../../../config.js";
import { AccessContext } from "../../../auth/AccessContext.js";
import { feedDate } from "../scheduleReviewPresentation.js";

// What Avail observed at the route's timepoints, by hour, under the schedule's
// run-time grid (plans/schedule-review-module-plan.md section 9). The hour
// columns line up with the run-time grid's, but they mean something
// different: there it is the hour a trip starts, here the hour a bus departed
// the timepoint. The page says so rather than pretending the two are one grid.
//
// Not compliance: Avail's own early/on-time/late classification over the
// window the reader picks, not the Official Departure OTP figure. It reads
// OTP data, so it loads only for someone with compliance-review.view.

const WINDOWS = [7, 28, 90] as const;
/** Readings shown before "show all": a route flat everywhere reads on every segment. */
const READINGS_SHOWN = 3;
type WindowDays = (typeof WINDOWS)[number];
const DAYS: { key: ObservedDayKind; label: string }[] = [
  { key: "weekday", label: "Weekdays" },
  { key: "saturday", label: "Saturdays" },
  { key: "sunday", label: "Sundays" },
];

type Load =
  | { state: "loading" }
  | { state: "ready"; observed: ObservedOtpResponse }
  | { state: "empty"; message: string }
  | { state: "error"; message: string };

function errorLoad(error: unknown): Load {
  if (error instanceof ApiError && error.status === 404) return { state: "empty", message: error.message };
  if (error instanceof ApiError && error.status === 403) return { state: "error", message: "What Avail observed needs Compliance access." };
  if (error instanceof ApiError && error.status === 401) return { state: "error", message: "Sign in again to see what Avail observed." };
  return { state: "error", message: "What Avail observed could not be loaded. Try again shortly." };
}

/** "PM peak under-run", "AM peak under-run" or "Midday over-run". Readings stored before v1.5.330 have no period. */
export function readingLabel(reading: Pick<ObservedReading, "kind" | "period">): string {
  if (reading.kind === "off_peak_over_run") return reading.period === "midday" ? "Midday over-run" : "Off-peak over-run";
  return reading.period === "am" ? "AM peak under-run" : reading.period === "pm" ? "PM peak under-run" : "Peak under-run";
}

/** The larger of the late and early shares, which is the one the cell is about. */
export function cellReading(cell: ObservedCell): { kind: "late" | "early" | "ontime"; pct: number } {
  if (cell.late_pct === 0 && cell.early_pct === 0) return { kind: "ontime", pct: cell.ontime_pct };
  return cell.late_pct >= cell.early_pct ? { kind: "late", pct: cell.late_pct } : { kind: "early", pct: cell.early_pct };
}

/** Warning strength by share: under 10 quiet, 10-24 noticeable, 25 and over strong. */
export function cellLevel(pct: number): 0 | 1 | 2 {
  return pct >= 25 ? 2 : pct >= 10 ? 1 : 0;
}

function hourLabel(hour: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}${hour < 12 ? "a" : "p"}`;
}

function windowSentence(observed: ObservedOtpResponse): string {
  const { window } = observed;
  const from = feedDate(window.first_day);
  const to = feedDate(window.last_day);
  // "20 weekdays", but "4 Saturdays": day names keep their capital.
  const kind = window.dow === "weekday" ? "weekdays" : DAYS.find((d) => d.key === window.dow)?.label ?? "days";
  const span = from && to ? `${from} – ${to}` : "no days";
  return `${window.service_days} ${kind} with data, ${span} · ${observed.departures.toLocaleString()} departures`;
}

export function ObservedGrid({ routeId, routeLabel, hours }: { routeId: string; routeLabel: string; hours: number[] }) {
  // Outside an AccessProvider (embedding, most tests) nothing is known, so nothing loads.
  const access = useContext(AccessContext);
  const allowed = access?.can("compliance-review.view") ?? false;
  const [days, setDays] = useState<WindowDays>(28);
  const [dow, setDow] = useState<ObservedDayKind>("weekday");
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [allReadings, setAllReadings] = useState(false);

  useEffect(() => {
    if (!allowed) return;
    let live = true;
    setLoad({ state: "loading" });
    setAllReadings(false);
    api.getGtfsPredictionRiskRouteObserved(routeId, { days, dow })
      .then((observed) => { if (live) setLoad({ state: "ready", observed }); })
      .catch((error: unknown) => { if (live) setLoad(errorLoad(error)); });
    return () => { live = false; };
  }, [allowed, routeId, days, dow]);

  if (access?.loading) return null;
  if (!allowed) {
    return (
      <section className="sr-observed" aria-labelledby="sr-observed-title">
        <h4 id="sr-observed-title" className="sr-grid-title">What Avail observed</h4>
        <p className="sr-foot">Comparing the schedule with what Avail observed at each timepoint needs Compliance access, because it reads OTP data.</p>
      </section>
    );
  }

  const observed = load.state === "ready" ? load.observed : null;
  // Every hour either grid has, so the columns line up with the run-time grid's.
  const columns = observed
    ? [...new Set([...hours, ...observed.timepoints.flatMap((tp) => tp.hours.map((h) => h.hour))])].sort((a, b) => a - b)
    : hours;

  return (
    <section className="sr-observed" aria-labelledby="sr-observed-title">
      <div className="sr-observed-head">
        <h4 id="sr-observed-title" className="sr-grid-title">What Avail observed at each timepoint, by the hour the bus departed</h4>
        <div className="sr-observed-controls">
          <div className="sr-seg-ctl" role="group" aria-label="Window">
            {WINDOWS.map((w) => (
              <button key={w} type="button" aria-pressed={days === w} onClick={() => setDays(w)}>{w} days</button>
            ))}
          </div>
          <div className="sr-seg-ctl" role="group" aria-label="Service days">
            {DAYS.map((d) => (
              <button key={d.key} type="button" aria-pressed={dow === d.key} onClick={() => setDow(d.key)}>{d.label}</button>
            ))}
          </div>
        </div>
      </div>

      {load.state === "loading" ? <p className="sr-muted">Loading what Avail observed…</p> : null}
      {load.state === "empty" ? <p className="sr-muted">{load.message}</p> : null}
      {load.state === "error" ? <p className="sr-error" role="alert">{load.message}</p> : null}

      {observed ? (
        <>
          <p className="sr-meta">{windowSentence(observed)}</p>

          {observed.readings.length > 0 ? (
            <>
              <ul className="sr-readings" aria-label={`Route ${routeLabel}: where the schedule and Avail disagree`}>
                {(allReadings ? observed.readings : observed.readings.slice(0, READINGS_SHOWN)).map((reading) => (
                  <li key={`${reading.from_stop_id}-${reading.to_stop_id}-${reading.period}`} className={reading.kind}>
                    <span className="sr-reading-kind">{readingLabel(reading)}</span>
                    {reading.text}
                  </li>
                ))}
              </ul>
              {observed.readings.length > READINGS_SHOWN && !allReadings ? (
                <button type="button" className="sr-btn sr-readings-more" onClick={() => setAllReadings(true)}>
                  Show all {observed.readings.length} readings
                </button>
              ) : null}
            </>
          ) : observed.schedule_available ? (
            <p className="sr-muted sr-no-reading">No segment scheduled the same all day shows a peak or off-peak difference at its next timepoint in this window.</p>
          ) : (
            <p className="sr-muted sr-no-reading">The schedule's evidence for this route is not kept yet (migration 145), so timepoints are in Avail's order and nothing is read against the schedule.</p>
          )}

          <div className="sr-scroll">
            <table className="sr-grid sr-observed-grid" aria-label={`Route ${routeLabel} Avail early and late shares per timepoint by departure hour`}>
              <thead>
                <tr>
                  <th scope="col">Timepoint</th>
                  <th scope="col" className="num">Dep.</th>
                  {columns.map((hour) => <th scope="col" className="num" key={hour}>{hourLabel(hour)}</th>)}
                </tr>
              </thead>
              <tbody>
                {observed.timepoints.map((tp) => {
                  const byHour = new Map(tp.hours.map((h) => [h.hour, h]));
                  return (
                    <tr key={`${tp.stop_id}-${tp.direction ?? ""}`} className={tp.in_schedule ? undefined : "unscheduled"}>
                      <th scope="row">
                        <span className="sr-seg">{tp.stop_name}</span>
                        {tp.direction ? <span className="sr-dir">{tp.direction}</span> : null}
                        {tp.in_schedule ? null : <span className="sr-dir" title="Avail measures this stop; the published schedule has no timepoint here">not a timepoint</span>}
                      </th>
                      <td className="num sr-muted">{tp.departures.toLocaleString()}</td>
                      {columns.map((hour) => {
                        const cell = byHour.get(hour);
                        if (!cell) return <td className="num" key={hour}><span className="sr-muted">·</span></td>;
                        const reading = cellReading(cell);
                        const level = reading.kind === "ontime" ? 0 : cellLevel(reading.pct);
                        const label = reading.kind === "ontime" ? "on time" : `${reading.pct}% ${reading.kind}`;
                        return (
                          <td
                            className={`num sr-obs ${reading.kind} l${level}`}
                            key={hour}
                            title={`${cell.departures} departures: ${cell.early_pct}% early, ${cell.ontime_pct}% on time, ${cell.late_pct}% late`}
                            aria-label={`${hourLabel(hour)}: ${label}, ${cell.departures} departures`}
                          >
                            {reading.kind === "ontime" ? "✓" : `${reading.pct}${reading.kind === "late" ? "L" : "E"}`}
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
            A cell is the larger of the late (L) and early (E) shares of departures from that timepoint in that hour, as
            Avail classified them; hover for the full split. These are Avail's own counts over the window above, not the
            Official Departure OTP figure: no stop or date exclusions are applied. A reading is made only where a segment
            is scheduled the same at every hour, in its own direction: when departures from its next timepoint run late
            in the morning (6–9am) or afternoon (3–7pm) peak at least fifteen points more than at midday (10am–3pm), and
            the late share rises across the segment by ten points or more, so the segment adding the lateness is named
            rather than one that only carries it on; or when they run early at midday fifteen points more than in the peaks.
          </p>
        </>
      ) : null}
    </section>
  );
}
