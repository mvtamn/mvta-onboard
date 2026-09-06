import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.0",
  date: "2026-08-06",
  sections: [
    {
      heading: "Added",
      items: [
        "OTP Compliance: a service-month picker, so Route Summary, Review Queue, Monthly Assessments, and Audit Stream can all show an earlier month, not just the current one.",
        "OTP Compliance: an admin \"Historical data backfill\" tool to pull in OTP Monthly and Missed Trips data for months before the feed's normal 3-month rolling window.",
        "OTP Compliance: Review Queue can now copy last month's approve/reject decision for a stop with one click (or all matching stops at once) instead of re-deciding every stop every month.",
        "OTP Compliance: reason codes (Review Queue, Weather exclusions) are now fully admin-editable - rename, reorder, and add, right from the Administration page.",
        "Missed Trips: route and service-date filters on the flagged-trip list.",
        "Missed Trips: the detail view now shows why a trip was flagged - an explicit cancellation vs. a scheduled trip that never showed up.",
        "Missed Trips: a reason-code dropdown alongside investigation notes, so an outcome can be tagged (vehicle breakdown, operator no-show, dispatch error, weather, detection error) instead of only free text.",
        "Missed Trips: a new Monthly Assessments view showing cancellations vs. no-shows and confirmed vs. false-positive counts by month and route.",
      ],
    },
    {
      heading: "Changed",
      items: [
        "OTP Compliance's month labels now read as MM/YYYY instead of a raw number, and the old placeholder \"Service Week\" stat strip is gone.",
        "Missed Trips no longer leads with a cryptic internal trip ID - the flagged-trip list now shows the route and scheduled time first.",
        "Missed Trips no longer offers a \"prepare rider alert\" action - it has been an investigation-only tool since it was introduced, and this leftover control didn't match that.",
      ],
    },
    {
      heading: "Fixed",
      items: [
        "OTP Compliance's Monthly and Missed Trips data is now fully live - both feeds were reading the wrong field name from Avail's response and had been showing no data since they launched.",
        "Fixed a data error that had been silently dropping some OTP Monthly rows for stops with longer day-of-week values.",
        "Fixed an \"Internal server error\" that could appear when approving or rejecting a Review Queue candidate.",
      ],
    },
  ],
};

export default entry;
