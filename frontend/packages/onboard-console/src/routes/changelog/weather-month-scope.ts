import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.305",
  date: "2026-10-04",
  sections: [
    {
      heading: "Fixed",
      items: [
        "Weather Exclusions shows the service month you have picked, like every other page in the module. It listed every weather and emergency day ever recorded, whichever month you were looking at.",
        "The Dashboard's weather count is for the month on screen. It counted every day ever recorded while the sentence on the Weather page beside it counted one month's — two numbers for the same thing.",
        "That card no longer says weather days are “not applied”. An approved day has subtracted its departures since the September release; the card now says how many of the month's days are approved and subtracting.",
      ],
    },
  ],
};

export default entry;
