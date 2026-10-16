import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.327",
  date: "2026-10-16",
  sections: [
    {
      heading: "Added",
      items: [
        "A route on the Schedule Review page now ends with what Avail observed: its timepoints against the hour a bus departed, each cell the share of departures that left late or early, for the last 7, 28 or 90 weekdays, Saturdays or Sundays.",
        "Above that grid, a plain sentence for each segment the schedule gives the same time all day where Avail sees the difference: \"the late share rises from 3% off-peak to 36% in the peak. The peak is under-run.\" That is evidence for a schedule change, not the change.",
        "Needs Compliance access, because it reads OTP data. Without it the schedule review shows as before, with one line saying why the comparison is not shown. These are Avail's own counts, not the official OTP figure.",
      ],
    },
  ],
};

export default entry;
