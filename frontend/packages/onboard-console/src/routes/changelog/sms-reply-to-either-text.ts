import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.231",
  date: "2026-09-17",
  sections: [
    {
      heading: "Fixed",
      items: [
        "A rider who signed up for text alerts twice with the same number can now reply with the code from either text. Before, only the newest code was checked, so replying to the first text was answered as a wrong code and cost the rider one of their five tries. The code they send confirms that signup, and the other one is merged into it as before.",
        "Guessing gets no easier. A wrong code now counts against every code still waiting on that number, so a second signup does not give anyone five more tries at it.",
      ],
    },
  ],
};

export default entry;
