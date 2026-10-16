import { SchedulePredictionRisk } from "./modules/SchedulePredictionRisk.js";
import "./modules/scheduleReview/scheduleReview.css";

// Schedule Review: analysis of the published static schedule, route by route,
// for what makes arrival predictions worse, with the evidence behind each flag
// and who can fix it. It is not compliance - no OTP figure, no contract target,
// nothing to approve - which is why it is its own page rather than a tab of
// the OTP module. Integrations & Data Health shows the same summary table and
// links each route here (?route=420 opens that route on arrival). Any
// signed-in role: the review is schedule data only.
export function ScheduleReview() {
  const initialRoute = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search).get("route");
  return (
    <>
      <div className="panel-header">Schedule Review</div>
      <div className="panel-body sr-page">
        <p className="sr-lede">
          A prediction engine starts from the published schedule and corrects it with each GPS ping. Where the schedule
          is wrong or silent, the correction has nothing good to start from. Each check below is one such place; open
          a route for the stop pairs, segments and hand-overs behind its flags, who owns the fix, and its scheduled
          running time hour by hour.
        </p>
        <SchedulePredictionRisk mode="page" initialRoute={initialRoute} />
      </div>
    </>
  );
}
