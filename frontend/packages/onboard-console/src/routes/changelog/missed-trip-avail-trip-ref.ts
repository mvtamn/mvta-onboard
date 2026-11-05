import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.7.38",
  date: "2026-11-04",
  sections: [
    {
      heading: "Changed",
      items: [
        "Missed Trips: the selected trip's header names the trip the way Avail does, \"Avail trip 1019-N\", instead of \"Ref t3FB-b3E-sl1C-v65\", so the same trip can be found in Avail. The GTFS trip ID moves to Technical details (and shows when you point at the reference). A trip whose ID is not in MVTA's form, such as a Spare request, still shows its raw reference.",
      ],
    },
  ],
};

export default entry;
