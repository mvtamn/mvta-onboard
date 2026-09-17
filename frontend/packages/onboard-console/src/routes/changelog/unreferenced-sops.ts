import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.243",
  date: "2026-09-17",
  sections: [
    {
      heading: "Added",
      items: [
        "Decision Matrix administration now tells you about SOPs in the approved library that no Procedure uses yet. The SOP folder is read each morning; open the list to see each document and when it first appeared, and choose Create Draft from this to start a Procedure with that SOP already chosen.",
        "If the morning read couldn't finish, hasn't run recently, or isn't set up, the notice says so instead of showing a count, so an empty list always means every SOP is covered.",
      ],
    },
  ],
};

export default entry;
