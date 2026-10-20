import { useContext, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ApiError, type ObservedSummaryResponse, type PredictionRiskReview } from "@mvta/shared";
import { api } from "../config.js";
import { AccessContext } from "../auth/AccessContext.js";
import { whenLabel } from "./modules/kpiTrustPresentation.js";
import { feedDate, feedSentence } from "./modules/scheduleReviewPresentation.js";
import { RouteList } from "./modules/scheduleReview/RouteList.js";
import { ScheduleRouteView } from "./modules/scheduleReview/ScheduleRouteView.js";
import { ScheduleReviewChanges } from "./modules/scheduleReview/ScheduleReviewChanges.js";
import { rankRoutes, type OwnerFilter, type RouteSort } from "./modules/scheduleReview/routeRanking.js";
import "./modules/scheduleReview/scheduleReview.css";

// Schedule Review (redesign after the 2026-10-16 critique; design canvas
// "Schedule Review redesign"): the routes ranked by what Avail confirms and
// what the schedule can fix, beside the open route. The open route lives in
// the URL (?route=420), so Back, bookmarks and shared links all land on it.
// Analysis, not compliance: any signed-in role reads the schedule review;
// Avail's counts need Compliance access, as the OTP data does.

type Load<T> = { state: "loading" } | { state: "ready"; data: T } | { state: "error"; message: string };

function reviewError(error: unknown): string {
  if (error instanceof ApiError && error.status === 503) {
    return "The database is missing migration 143, so no schedule review has been kept. Run sql/migration-143-gtfs-prediction-risk-reviews.sql.";
  }
  if (error instanceof ApiError && error.status === 401) return "Sign in again to see the schedule review.";
  return "The schedule review could not be loaded.";
}

export function ScheduleReview() {
  const access = useContext(AccessContext);
  const canSeeObserved = access?.can("compliance-review.view") ?? false;
  const [params] = useSearchParams();
  const routeParam = params.get("route");
  const [review, setReview] = useState<Load<PredictionRiskReview | null>>({ state: "loading" });
  const [reviewTry, setReviewTry] = useState(0);
  const [observed, setObserved] = useState<Load<ObservedSummaryResponse>>({ state: "loading" });
  const [sort, setSort] = useState<RouteSort>("confirmed");
  const [owner, setOwner] = useState<OwnerFilter>("all");
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setReview({ state: "loading" });
    api.getGtfsPredictionRisk()
      .then((result) => { if (live) setReview({ state: "ready", data: result.review }); })
      .catch((error: unknown) => { if (live) setReview({ state: "error", message: reviewError(error) }); });
    return () => { live = false; };
  }, [reviewTry]);

  useEffect(() => {
    if (!canSeeObserved) return;
    let live = true;
    api.getGtfsPredictionRiskObservedSummary({ days: 28, dow: "weekday" })
      .then((data) => { if (live) setObserved({ state: "ready", data }); })
      .catch(() => { if (live) setObserved({ state: "error", message: "unavailable" }); });
    return () => { live = false; };
  }, [canSeeObserved]);

  const data = review.state === "ready" ? review.data : null;
  const observedState = !canSeeObserved ? "no-access" : observed.state;
  const summary = observed.state === "ready" ? observed.data : null;
  const items = data ? rankRoutes(data.routes, data.checks, summary?.routes ?? null, sort, owner) : [];
  // With no route in the URL, open the top-ranked one, without adding history.
  const selected = routeParam ?? items[0]?.routeId ?? null;
  const selectedRoute = data?.routes.find((r) => r.route_id === selected) ?? null;
  const windowNote = summary ? `${summary.window.service_days} weekdays to ${feedDate(summary.window.last_day) ?? "yesterday"}` : null;

  return (
    <>
      <div className="panel-header">Schedule Review</div>
      <div className="panel-body sr-page">
        <header className="sr-page-head">
          <div>
            <h1>Schedule Review</h1>
            <p className="sr-lede">Where the published schedule makes arrival predictions worse, and where Avail saw it happen on the street.</p>
          </div>
          {data ? <p className="sr-meta">{feedSentence(data.feed)} · reviewed {whenLabel(data.reviewed_at)}</p> : null}
        </header>

        {review.state === "loading" ? <p className="sr-muted">Loading the schedule review…</p> : null}
        {review.state === "error" ? (
          <div className="sr-inline-error">
            <p className="sr-error" role="alert">{review.message}</p>
            <button type="button" className="sr-btn" onClick={() => setReviewTry((n) => n + 1)}>Try again</button>
          </div>
        ) : null}
        {review.state === "ready" && !data ? <p className="sr-muted">No schedule review yet. One is kept with the next daily static GTFS import.</p> : null}

        {data ? (
          <>
            <ScheduleReviewChanges mode="notice" checks={data.checks} />
            <div className="sr-layout">
              <RouteList
                items={items}
                total={data.routes.length}
                selected={selected}
                sort={sort}
                onSort={setSort}
                owner={owner}
                onOwner={setOwner}
                observedState={observedState}
                windowNote={windowNote}
                onPick={setPicked}
              />
              {selected ? (
                <ScheduleRouteView
                  key={selected}
                  routeId={selected}
                  routeLabel={selectedRoute?.route_short_name ?? selected}
                  focusOnLoad={picked === selected}
                />
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </>
  );
}
