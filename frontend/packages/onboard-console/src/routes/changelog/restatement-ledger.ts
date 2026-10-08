import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.295",
  date: "2026-09-22",
  sections: [
    {
      heading: "Added",
      items: [
        "OnBoard now records it when Avail publishes different numbers for a month that has already ended, keeping what the figure used to say alongside what it says now. Until now a restatement was invisible: the contractor's figure would quietly change and nothing could say when, or by how much.",
        "Reporting gains a view of those restatements — the month, route, stop and day, both figures, the change in departures and on-time departures, and how long after the month ended it happened.",
      ],
    },
    {
      heading: "Fixed",
      items: [
        "The \"last updated\" time on OTP monthly data was being reset on every nightly poll whether or not anything had changed, so it only ever showed when the poller last ran. It now moves when the data actually moves, which is what makes a restatement detectable at all.",
      ],
    },
  ],
};

export default entry;
