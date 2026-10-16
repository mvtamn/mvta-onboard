import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.326",
  date: "2026-10-16",
  sections: [
    {
      heading: "Added",
      items: [
        "The schedule review can now be read against what Avail observed: for each route, Avail's early, on-time and late shares at every timepoint by hour over the last 7, 28 or 90 weekdays, Saturdays or Sundays, with a reading for each segment scheduled the same at every hour whose timepoint runs late in the peak or early off-peak. Served to the console for the next release; needs Compliance access, as the OTP data does.",
      ],
    },
  ],
};

export default entry;
