import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.72",
  date: "2026-09-04",
  sections: [
    {
      heading: "Fixed",
      items: [
        "Feed health across every ingestion feed now reflects what each poll actually recorded rather than what the source returned, so a poll that stores nothing is reported as a failure instead of a healthy run at full volume.",
        "A vehicle-position poll that records no operational evidence no longer counts as proof that trip-start coverage was available, so trips with no evidence wait for data instead of being treated as no-shows.",
        "A missed-trip reload whose reports cannot be read no longer erases the months it was refreshing; the retained evidence is kept and the run is reported as a failure.",
      ],
    },
    {
      heading: "Changed",
      items: [
        "The two pollers that read the GTFS-RT trip update feed now record its health once, through one shared reader, instead of each writing the same trust record and overwriting the other.",
      ],
    },
  ],
};

export default entry;
