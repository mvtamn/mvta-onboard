import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.10",
  date: "2026-08-08",
  sections: [
    {
      heading: "Changed",
      items: [
        "Missed Trips now keeps GTFS and Spare evidence distinct in one review queue. Spare candidates show the exact late-start, same-duty supersession, and late-arrival conditions that triggered them.",
        "The Spare pipeline reads only bounded recent Requests and Slots windows, retains no rider contact or location data, and excludes rider/no-fault or unattributed cancellations from automatic contractor findings.",
        "The review queue, history, feed-health warnings, and monthly assessment views now carry source-aware evidence and labels.",
      ],
    },
  ],
};

export default entry;
