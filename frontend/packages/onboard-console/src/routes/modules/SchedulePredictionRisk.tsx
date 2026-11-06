import { useEffect, useState } from "react";
import { Link, useInRouterContext } from "react-router-dom";
import { ApiError, type PredictionRiskReview } from "@mvta/shared";
import { api } from "../../config.js";
import { whenLabel } from "./kpiTrustPresentation.js";
import { OWNER_LABEL, feedDate, formatRiskValue, scheduleReviewPath, thresholdSentence } from "./scheduleReviewPresentation.js";
import { ScheduleReviewChanges } from "./scheduleReview/ScheduleReviewChanges.js";

export { formatRiskValue } from "./scheduleReviewPresentation.js";

// Integrations & Data Health > Schedule data: the latest static sync's review
// of where the published schedule makes arrival predictions worse, per route.
// It is about the schedule MVTA publishes, not about whether a feed answers,
// so it sits below the connectivity checks. Each route name opens that route
// on the Schedule Review page, where the analysis lives.

type Load =
  | { state: "loading" }
  | { state: "ready"; review: PredictionRiskReview | null }
  | { state: "error"; message: string };

function errorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 401) return "Sign in again to see the schedule review.";
  return "The schedule review could not be loaded. Try again shortly.";
}

export function SchedulePredictionRisk() {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  // Outside a router (tests, embedding) a route name stays plain text.
  const inRouter = useInRouterContext();

  useEffect(() => {
    let live = true;
    api.getGtfsPredictionRisk()
      .then((result) => { if (live) setLoad({ state: "ready", review: result.review }); })
      .catch((error: unknown) => { if (live) setLoad({ state: "error", message: errorMessage(error) }); });
    return () => { live = false; };
  }, []);

  const review = load.state === "ready" ? load.review : null;
  const flagged = review?.routes.filter((route) => route.flag_count > 0).length ?? 0;
  const from = feedDate(review?.feed.start_date ?? null);
  const to = feedDate(review?.feed.end_date ?? null);

  return (
    <section className="ih-section" aria-labelledby="ih-schedule-title">
      <div className="ih-section-head">
        <div>
          <span className="ih-eyebrow">Schedule data</span>
          <h2 id="ih-schedule-title">Where the schedule makes predictions worse</h2>
          <p>
            Checked on every static GTFS import. Each flag is something in the published schedule that leaves the
            arrival prediction riders see with less to go on. Fixing the schedule improves predictions whichever
            vendor produces them.
          </p>
        </div>
        {review && (
          <div className="ih-section-aside">
            <span>Reviewed {whenLabel(review.reviewed_at)}{review.confirmed_at ? `, confirmed ${whenLabel(review.confirmed_at)}` : ""}</span>
          </div>
        )}
      </div>

      {load.state === "loading" && <p className="ih-table-empty">Loading the schedule review…</p>}
      {load.state === "error" && <p className="ih-error" role="alert">{load.message}</p>}
      {load.state === "ready" && !review && (
        <p className="ih-table-empty">No schedule review yet. One is kept with the next daily static GTFS import.</p>
      )}

      {review && (
        <>
          <p className="ih-risk-summary">
            <span><strong>{flagged} of {review.routes.length} routes</strong> have at least one flag. Routes with the most flags come first; a route name opens its evidence on the Schedule Review page.</span>
            <span className="ih-risk-feed">
              {review.feed.version ? `Feed ${review.feed.version}` : "Feed"}
              {from && to ? ` · ${from} – ${to}` : ""}
            </span>
          </p>
          <ScheduleReviewChanges mode="summary" checks={review.checks} />
          <div className="ih-risk-scroll">
            <table className="ih-risk" aria-label="Schedule prediction risk by route">
              <thead>
                <tr>
                  <th scope="col">Route</th>
                  <th scope="col" className="num">Flags</th>
                  {review.checks.map((definition) => (
                    <th scope="col" className="num" key={definition.id}>{definition.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {review.routes.map((route) => (
                  <tr key={route.route_id}>
                    <th scope="row">
                      {inRouter ? (
                        <Link to={scheduleReviewPath(route.route_id)} title="Open this route on the Schedule Review page">{route.route_short_name}</Link>
                      ) : route.route_short_name}
                      <small>{route.trip_count.toLocaleString()} trips</small>
                    </th>
                    <td className="num"><span className={`ih-risk-count${route.flag_count ? " flagged" : ""}`}>{route.flag_count}</span></td>
                    {review.checks.map((definition) => {
                      const result = route.checks.find((check) => check.id === definition.id);
                      const value = formatRiskValue(definition, result?.value ?? null);
                      return (
                        <td
                          className={`num${result?.flagged ? " flagged" : ""}`}
                          key={definition.id}
                          aria-label={result?.flagged ? `${value}, flagged` : undefined}
                        >
                          {value}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <dl className="ih-risk-legend">
            {review.checks.map((definition) => (
              <div key={definition.id}>
                <dt>{definition.label} <span>{thresholdSentence(definition)}</span></dt>
                <dd>{definition.why}</dd>
                <dd className="ih-risk-fix"><strong>{OWNER_LABEL[definition.owner]}:</strong> {definition.fix}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </section>
  );
}
