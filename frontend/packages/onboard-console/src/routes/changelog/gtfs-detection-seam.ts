import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.259",
  date: "2026-09-18",
  sections: [
    {
      heading: "Changed",
      items: [
        "Fixed-route missed-trip detection reads through one injected seam, so the rules that decide which trips are judged — past its deadline, already started, a special-event route, which service day it belongs to, and what the day's own evidence can support — can be tested without a database. Nothing about detection changes; this is the groundwork for measuring the silent no-show detector's precision before it leaves Shadow detection.",
      ],
    },
  ],
};

export default entry;
