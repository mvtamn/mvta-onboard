import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.207",
  date: "2026-09-13",
  sections: [
    {
      heading: "Changed",
      items: [
        "The live indicator on Service Risk and the Dispatch Log now follows the feed itself rather than the console's own refreshes. The console checks every 30 seconds, but new fixed-route data only arrives every five minutes, so the indicator used to flash and count down as if data were arriving when nothing had changed.",
        "The ring now counts down to the next five-minute delivery, and the flash and banner sweep happen once, when new data actually lands. Between deliveries the banner holds still. If a delivery is late, the ring stays empty and the poll bars start showing missed deliveries.",
      ],
    },
  ],
};

export default entry;
