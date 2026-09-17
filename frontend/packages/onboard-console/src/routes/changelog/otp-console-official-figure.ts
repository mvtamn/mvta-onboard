import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.243",
  date: "2026-09-17",
  sections: [
    {
      heading: "Changed",
      items: [
        "Route Summary and the Dashboard show the official OTP figure the server measures — fixed-route service with approved stop exclusions removed — instead of one the browser worked out for itself. Both pages now compare it against the month's real target rather than a fixed 85%.",
        "A route the fixed-route standard does not cover — special event, on-demand, or non-revenue — says so instead of appearing as 0% on time.",
        "Weather Exclusions says plainly that a recorded day is kept for the record and is not removed from the OTP figures, and why: Avail's monthly feed is grouped by day of week, not by date.",
        "Monthly Assessments shows the figure the month was actually assessed at, where it has been assessed, and marks a month with no assessment yet as provisional.",
      ],
    },
    {
      heading: "Added",
      items: [
        "Route classification has a Non-revenue category for deadhead, training and maintenance runs. Those routes are outside the fixed-route standards, so they can no longer count toward on-time performance.",
      ],
    },
  ],
};

export default entry;
