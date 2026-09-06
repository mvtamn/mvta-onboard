import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.98",
  date: "2026-09-05",
  sections: [
    {
      heading: "Changed",
      items: [
        "Garage-departure review now also covers the conditions that prevent a bus leaving at all - no operator assigned, no vehicle assigned, an unavailable or double-booked vehicle, and a missed check-in. None of these has occurred in the recorded history, so nothing changes today; they are covered in advance because a condition the rule does not list is one it ignores without saying so.",
      ],
    },
  ],
};

export default entry;
