import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.140",
  date: "2026-09-07",
  sections: [
    {
      heading: "Changed",
      items: [
        "A performance standard now records where its figure actually comes from, in four ways instead of two: ingested from a feed, raised by OnBoard's own compliance modules, entered by hand, or transcribed from another system's structured report. The previous two values each covered two different situations \u2014 a feed the application reads was indistinguishable from occurrences OnBoard raises itself, and a figure somebody knows was indistinguishable from one read off a Nexus or Asset Works M5 report.",
        "A standard transcribed from another system names that system, picked from Nexus (Trackit) and Asset Works M5 or typed in for one not yet listed. It says who to chase when a month's figure is missing, and marks the standards that could be fed automatically once those integrations exist.",
        "Changing where a figure comes from clears the fields the new kind does not use, so a hand-entered standard cannot keep a stale feed reference that makes it read as automatic.",
      ],
    },
    {
      heading: "Fixed",
      items: [
        "The monthly figures form lists standards transcribed from another system as well as those entered from scratch. Both are typed in by a person, so reclassifying one would otherwise have quietly removed it from the form somebody enters it on.",
      ],
    },
  ],
};

export default entry;
