import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.133",
  date: "2026-09-06",
  sections: [
    {
      heading: "Changed",
      items: [
        "Confirming a missed trip now puts it in that service month's performance assessment straight away, and asks whose error it was at the same time. Reviewing used to be the first of two sittings: the candidate poll noticed the confirmation some minutes later, raised an occurrence marked undetermined, and someone re-reviewed it in a different module before it counted for anything. Attribution — contractor error, excusable delay, MVTA-directed, or undetermined — is now part of the review, and only contractor error charges a penalty. Choosing undetermined behaves exactly as before and leaves the decision to the Performance Assessment queue.",
        "Recording a missed trip as a false positive now retracts any occurrence already raised from it. A trip the agency has decided never happened previously stayed in the month's queue.",
        "Garage Departures carries an Assessment column on both the Fixed Route and On-Demand views. The Outcome column says what the contract rule judged; this one says whether anyone charged it, and lets a reviewer settle it in place — the same action the Performance Assessment occurrence queue takes, so a duty settled in either place is identical afterwards.",
        "The Performance Assessment Occurrence Log names the observation each occurrence came from — the trip, or the block and run — and links back to Compliance, instead of leaving a reviewer to decode a source_ref string.",
      ],
    },
    {
      heading: "Fixed",
      items: [
        "A review is never blocked or lost because the assessment side is not ready. Whether a trip was missed is a fact about service; when no Performance Agreement covers the date, the standard is not scored on that Agreement, or the month is already finalized, the review still saves and the console says which of those happened rather than failing silently.",
        "A finalized or issued month is never changed as a side effect of reviewing an observation. Restating one stays a manager reopening the period with a logged reason.",
      ],
    },
  ],
};

export default entry;
