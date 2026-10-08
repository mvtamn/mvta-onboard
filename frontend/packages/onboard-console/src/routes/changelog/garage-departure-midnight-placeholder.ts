import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.285",
  date: "2026-09-21",
  sections: [
    {
      heading: "Fixed",
      items: [
        "Garage departures no longer charge the contractor for runs Avail never scheduled. Avail publishes a run with no committed pullout time as midnight rather than leaving it blank, and those rows were being read as buses that failed to leave the garage — about 18 a day, the same placeholder blocks every time, none of which has ever departed.",
        "They were most of what the nightly review queue contained: across the departures held on file, 1,091 reviewable runs become 397 once the placeholders are set aside. Fixed Route Garage Departures now shows them as “No schedule” instead of “No departure”, and they raise nothing against the assessment.",
        "Placeholders raised before this change are still in the queue and need dismissing by hand — the assessment never withdraws an occurrence on its own.",
      ],
    },
  ],
};

export default entry;
