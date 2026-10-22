import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.6.34",
  date: "2026-10-22",
  sections: [
    {
      heading: "Fixed",
      items: [
        "Dispatch Log days from September 21 to October 22 no longer show about 2,270 trips as leaving 5-15 minutes early and on time, once migration 149 is applied. Those times were the bus arriving at its first stop, not leaving it. The trips now show no actual start, because the real departure time can no longer be recovered. Trips where the bus clearly did leave early are kept as they were.",
      ],
    },
  ],
};

export default entry;
