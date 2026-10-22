import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.6.22",
  date: "2026-10-21",
  sections: [
    {
      heading: "Fixed",
      items: [
        "Silent no-shows no longer flag buses that left late but inside the 30 minutes. The detector only believed a bus had started once it reported past its first stop, which on dev arrives 4-13 minutes after the bus leaves - so a bus that left 25 minutes late reached the deadline looking missed. It now also takes the Dispatch Log's first-stop departure, as long as a bus reported on the trip and the time is not just the schedule or a prediction repeated. Of the 118 silent no-shows since September 16, 51 would not have been raised.",
      ],
    },
  ],
};

export default entry;
