import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.292",
  date: "2026-09-22",
  sections: [
    {
      heading: "Changed",
      items: [
        "The Review Queue shows the stops the API flagged, at the early/late bias threshold on the Administration page. The browser used to work the list out for itself against a threshold of its own, so the value an administrator applied and the value reviewers actually saw could differ.",
        "Stops on special-event, on-demand and non-revenue routes no longer appear in the queue. Excluding one changed no figure, because the route is already outside official departure OTP — the work could never have counted.",
        "A queue row now reads the day of week and the departures sampled. It used to print a direction the monthly feed does not carry, as “—”, on every row.",
        "The Threshold Tuner asks the API for the count at a trial threshold, and can preview against any past month rather than only the current one — useful when this month has little data yet.",
      ],
    },
    {
      heading: "Removed",
      items: [
        "The Review Queue's eleven sample stops, shown before the feed had data. Approving one did nothing but change the screen: there was no real stop behind it to record a decision against. The queue now says the feed has no rows for the month. Route Summary keeps its sample routes.",
      ],
    },
  ],
};

export default entry;
