import { useEffect, useState } from "react";
import { Link, useInRouterContext } from "react-router-dom";
import { ApiError, type PredictionRiskCheckDefinition, type ReviewFlagChange, type ReviewHistoryResponse } from "@mvta/shared";
import { api } from "../../../config.js";
import { formatRiskValue, scheduleReviewPath } from "../scheduleReviewPresentation.js";
import "./scheduleReview.css";

// What changed between two schedule reviews (lib/scheduleReview/diff.ts). On
// the Schedule Review page it is a section: pick an earlier review, see the
// flags gained and lost route by route, open a route from any line. On
// Integrations & Data Health it is one line pointing at that section.
//
// It says which kind of change it is. A new feed is news about the schedule;
// the same feed reviewed by newer checks is news about the review, and the
// page says so rather than letting a new check read as the schedule getting
// worse.

type Load =
  | { state: "loading" }
  | { state: "ready"; data: ReviewHistoryResponse }
  | { state: "error"; message: string };

function errorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 503) return "No schedule review has been kept yet (migration 143).";
  return "The schedule review's history could not be loaded. Try again shortly.";
}

// Always with the day: two moments compared in one sentence must both say when.
// (whenLabel drops the date for today, which reads as "Oct 14 and 12:10 AM".)
function dated(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function feedLabel(version: string | null): string {
  return version ? `feed ${version}` : "a feed with no version";
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function ScheduleReviewChanges({
  mode,
  checks,
  onOpenRoute,
}: {
  mode: "summary" | "page";
  checks: PredictionRiskCheckDefinition[];
  /** Page mode: open a route's review in place. */
  onOpenRoute?: (routeId: string) => void;
}) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [compareWith, setCompareWith] = useState<number | null>(null);
  const inRouter = useInRouterContext();

  useEffect(() => {
    let live = true;
    api.getGtfsPredictionRiskHistory(compareWith === null ? {} : { from: compareWith })
      .then((data) => { if (live) setLoad({ state: "ready", data }); })
      .catch((error: unknown) => { if (live) setLoad({ state: "error", message: errorMessage(error) }); });
    return () => { live = false; };
  }, [compareWith]);

  const data = load.state === "ready" ? load.data : null;
  const diff = data?.diff ?? null;
  const definition = (id: string) => checks.find((c) => c.id === id);
  const label = (id: string) => definition(id)?.label ?? id;
  const value = (id: string, v: number | null) => {
    const d = definition(id);
    return d ? formatRiskValue(d, v) : v === null ? "—" : String(v);
  };

  const headline = diff
    ? diff.cause === "feed"
      ? `Since ${feedLabel(diff.from.feed_version)}: ${count(diff.gained.length, "flag gained", "flags gained")}, ${diff.lost.length} lost`
      : `Same ${feedLabel(diff.to.feed_version)}, reviewed by newer checks: ${count(diff.gained.length, "flag gained", "flags gained")}, ${diff.lost.length} lost`
    : null;

  if (mode === "summary") {
    if (!headline) return null;
    return (
      <p className="sr-changes-line">
        {headline}.{" "}
        {inRouter ? <Link to="/schedule-review">See what changed on Schedule Review</Link> : null}
      </p>
    );
  }

  const earlier = data ? data.history.filter((entry) => entry.review_id !== data.history[0]?.review_id) : [];

  const routeName = (change: ReviewFlagChange) => onOpenRoute ? (
    <button type="button" className="sr-open" onClick={() => onOpenRoute(change.route_id)} aria-label={`Open schedule review for route ${change.route_short_name}`}>
      {change.route_short_name}
    </button>
  ) : inRouter ? <Link to={scheduleReviewPath(change.route_id)}>{change.route_short_name}</Link> : change.route_short_name;

  const changeList = (title: string, changes: ReviewFlagChange[], kind: "gained" | "lost") => changes.length === 0 ? null : (
    <div className={`sr-change-group ${kind}`}>
      <h4 className="sr-change-title">{title}</h4>
      <ul aria-label={title}>
        {changes.map((change) => (
          <li key={`${change.route_id}-${change.check_id}`}>
            <span className="sr-change-route">{routeName(change)}</span>
            <span className="sr-change-check">{label(change.check_id)}</span>
            <span className="sr-change-values">{value(change.check_id, change.from_value)} → {value(change.check_id, change.to_value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <section className="sr-changes" aria-labelledby="sr-changes-title">
      <div className="sr-changes-head">
        <h3 id="sr-changes-title" className="sr-table-title">What changed</h3>
        {earlier.length > 1 ? (
          <label className="sr-changes-pick">
            Compared with
            <select value={compareWith ?? diff?.from.review_id ?? ""} onChange={(e) => setCompareWith(Number(e.target.value))}>
              {earlier.map((entry) => (
                <option key={entry.review_id} value={entry.review_id}>
                  {entry.feed_version ? `Feed ${entry.feed_version}` : "Feed"}, first seen {dated(entry.first_seen_at)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {load.state === "loading" ? <p className="sr-muted">Loading the review's history…</p> : null}
      {load.state === "error" ? <p className="sr-error" role="alert">{load.message}</p> : null}

      {data && !diff ? (
        <p className="sr-muted">
          {data.history.length === 0
            ? "No schedule review has been kept yet."
            : `Only one review has been kept so far (${feedLabel(data.history[0].feed_version)}, since ${dated(data.history[0].first_seen_at)}). Changes show here once the next feed, or a change to the checks, is reviewed.`}
        </p>
      ) : null}

      {diff ? (
        <>
          <p className="sr-changes-summary"><strong>{headline}.</strong>{" "}
            {diff.cause === "feed"
              ? `${feedLabel(diff.to.feed_version)} was first reviewed ${dated(diff.to.reviewed_at)}, against ${feedLabel(diff.from.feed_version)} reviewed ${dated(diff.from.reviewed_at)}. Routes flagged went from ${diff.flagged_routes.from} to ${diff.flagged_routes.to}.`
              : `The published schedule did not change between ${dated(diff.from.reviewed_at)} and ${dated(diff.to.reviewed_at)}; how it is checked did. A flag gained here is something the checks now see, not something the schedule got worse at.`}
          </p>
          {diff.checks_added.length > 0 ? (
            <p className="sr-changes-note">Checks added: {diff.checks_added.map(label).join(", ")}. A check one review never ran is not counted as a flag gained.</p>
          ) : null}
          {diff.checks_removed.length > 0 ? (
            <p className="sr-changes-note">Checks no longer run: {diff.checks_removed.map(label).join(", ")}.</p>
          ) : null}
          {diff.routes_added.length > 0 ? (
            <p className="sr-changes-note">New in the feed: {diff.routes_added.map((r) => `${r.route_short_name} (${count(r.flag_count, "flag", "flags")})`).join(", ")}.</p>
          ) : null}
          {diff.routes_removed.length > 0 ? (
            <p className="sr-changes-note">No longer in the feed: {diff.routes_removed.map((r) => r.route_short_name).join(", ")}.</p>
          ) : null}
          {diff.gained.length === 0 && diff.lost.length === 0 ? (
            <p className="sr-muted">No route gained or lost a flag on a check both reviews ran.</p>
          ) : (
            <div className="sr-change-groups">
              {changeList("Flags gained", diff.gained, "gained")}
              {changeList("Flags lost", diff.lost, "lost")}
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}
