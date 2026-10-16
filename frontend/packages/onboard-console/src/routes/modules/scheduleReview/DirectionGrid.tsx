import { useEffect, useState } from "react";
import type { ObservedReading, ObservedTimepoint, TimepointSegmentDetail } from "@mvta/shared";
import { DIRECTION_LABELS, buildGrid, gridDirections, hourLabel, type GridCell } from "./directionGridModel.js";

// One grid per direction: schedule above street in every cell (Schedule
// Review redesign, design canvas "RouteStrip"). Rows are segments in running
// order, led by departures from the direction's first timepoint; a segment
// scheduled the same all day carries the marker, and a confirmed reading sits
// under its segment's name.

/** The hours the readings call the peaks (lib/scheduleReview/observed.ts). */
const PEAK = new Set([6, 7, 8, 15, 16, 17, 18]);

function Cell({ cell }: { cell: GridCell }) {
  const o = cell.observed;
  const tone = o ? `${o.kind} l${o.level}` : "none";
  return (
    <td className={`sr-cell ${tone}${PEAK.has(cell.hour) ? " peak" : ""}`} aria-label={cell.label}>
      <span className="sr-sched">{cell.scheduled ?? ""}</span>
      <span className="sr-obs">{o ? o.text : ""}</span>
    </td>
  );
}

export function DirectionGrid({
  routeLabel,
  segments,
  timepoints,
  readings,
  windowSentence,
  dimmed,
}: {
  routeLabel: string;
  segments: TimepointSegmentDetail[];
  /** null when Avail's counts are not shown (no access, loading, error). */
  timepoints: ObservedTimepoint[] | null;
  readings: ObservedReading[];
  windowSentence: string | null;
  /** A refetch is in flight: keep showing the last grid, quieter. */
  dimmed: boolean;
}) {
  const directions = gridDirections(segments);
  const [direction, setDirection] = useState<string | null>(directions[0] ?? null);
  // A new route opens on its first direction.
  const firstDirection = directions[0] ?? null;
  useEffect(() => { setDirection(firstDirection); }, [routeLabel, firstDirection]);
  const current = directions.includes(direction) ? direction : directions[0] ?? null;
  const { hours, rows } = buildGrid(segments, current, timepoints, readings);
  const name = current ? DIRECTION_LABELS[current] ?? current : "All trips";
  const first = rows[0]?.from;
  const last = rows[rows.length - 1]?.to;

  const caption = `${name}${first && last ? `, ${first} to ${last}` : ""}. Top: scheduled minutes for a bus leaving the segment that hour.`
    + (timepoints ? ` Below: share of departures from its last timepoint that left late (L) or early (E) that hour${windowSentence ? `, ${windowSentence}` : ""}.` : "");
  return (
    <div className="sr-dgrid">
      {directions.length > 1 ? (
        <div className="sr-seg-ctl" role="group" aria-label="Direction">
          {directions.map((d) => (
            <button key={d ?? "all"} type="button" aria-pressed={d === current} onClick={() => setDirection(d)}>
              {d ? DIRECTION_LABELS[d] ?? d : "All trips"}
            </button>
          ))}
        </div>
      ) : null}
      {/* The caption is drawn above the scroll area, not inside it, so it wraps
          to the visible width instead of scrolling sideways with the hours.
          Screen readers get the same sentence as the table's caption. */}
      <p className="sr-grid-caption" aria-hidden="true">{caption}</p>
      <div className={`sr-scroll${dimmed ? " dimmed" : ""}`} tabIndex={0} aria-label={`Route ${routeLabel} ${name.toLowerCase()} running time by hour`}>
        <table className="sr-grid">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              <th scope="col" className="sr-rowhead">Segment</th>
              {hours.map((h) => <th scope="col" key={h} className={`num${PEAK.has(h) ? " peak" : ""}`}>{hourLabel(h)}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className={row.segment ? undefined : "origin"}>
                <th scope="row" className="sr-rowhead">
                  {row.flat ? <span className="sr-flat">Same all day</span> : null}
                  <span className="sr-seg-from">{row.segment ? row.from : `Leaves ${row.from}`}</span>
                  {row.to ? <span className="sr-seg-to">to {row.to}</span> : null}
                  <span className="sr-seg-meta">
                    {row.miles !== null ? `${row.miles} mi` : "Departures from the first timepoint"}
                    {row.segment && timepoints && !row.measured ? " · not measured at this stop" : ""}
                  </span>
                  {row.readings.map((r) => (
                    <span key={`${r.period}-${r.kind}`} className="sr-row-reading">
                      {r.kind === "peak_under_run"
                        ? `${r.period === "am" ? "AM" : "PM"} peak under-run: ${r.peak_pct}% late against ${r.off_peak_pct}% midday${r.upstream_pct !== null ? `, up from ${r.upstream_pct}%` : ""}`
                        : `Midday over-run: ${r.off_peak_pct}% early against ${r.peak_pct}% in the peaks`}
                    </span>
                  ))}
                </th>
                {row.cells.map((cell) => <Cell key={cell.hour} cell={cell} />)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="sr-key" aria-hidden="true">
        <span><strong>20</strong> scheduled minutes</span>
        {timepoints ? (
          <>
            <span><i className="sr-swatch late l1">32L</i> late 10–24%</span>
            <span><i className="sr-swatch late l2">58L</i> late 25%+</span>
            <span><i className="sr-swatch early l1">30E</i> early 10%+</span>
            <span><i className="sr-swatch ok">ok</i> none late or early</span>
          </>
        ) : null}
        <span><i className="sr-swatch peak" /> 6–9am and 3–7pm peaks</span>
      </div>
    </div>
  );
}
