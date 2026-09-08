import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.145",
  date: "2026-09-07",
  sections: [
    {
      heading: "Added",
      items: [
        "Reporting views for the measurements themselves — monthly on-time performance by route and stop, sub-monthly OTP trending, every detected missed trip from both pipelines, and every garage departure from both Avail pullouts and Spare duties. The existing scorecard views show a finalized month's scored result; these answer the question it always provokes, which is which stops, which trips and which runs produced it.",
        "A feed-health view, so a report can state the same caveats the console does about how fresh each measurement is and when a feed last failed.",
      ],
    },
    {
      heading: "Changed",
      items: [
        "Fixed-route and on-demand garage departures arrive as one list rather than two. They are one performance standard, and a report that had to combine them itself would be re-deciding a question already settled: Avail pullouts measure fixed route, Spare duties measure on-demand.",
        "Each OTP row says whether it counts toward the assessed figure and why not when it does not — a special-event route, or an approved stop exclusion with the reason it was approved for. Nothing is filtered out, so the raw number the contractor is entitled to see and the assessed number can be shown side by side and reconciled.",
        "A missed trip that could not be judged because a feed was down is published as exactly that, rather than counted as a missed trip. So is one detected before the timezone correction and kept only for audit.",
        "A garage departure carries the review decision OnBoard actually made about it — raised, confirmed, or dismissed with the reason — instead of the report deciding for itself what counts as late. The lateness threshold and the end-of-service-day rule stay in one place, so changing them cannot leave a report reading the old rule.",
        "Sub-monthly OTP trending is marked as unofficial on every row. Its field mapping has never been confirmed against a live Avail response and it keeps only 90 days, so it can inform a trend but cannot quietly become a compliance figure.",
        "Garage departures name the operator or driver, from whichever source the departure came from, alongside the identifier already carried. A late pullout is investigated by talking to whoever was on it, and an identifier alone sends the reader back to the console to find out who that was.",
      ],
    },
  ],
};

export default entry;
