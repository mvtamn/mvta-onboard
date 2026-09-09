import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.163",
  date: "2026-09-09",
  sections: [
    {
      heading: "Fixed",
      items: [
        "Adding a second direction rule for the same Monitoring Area and boundary movement now suggests the next free priority instead of defaulting to one already taken, which the server refused; a refusal now says which rule it collided with.",
        "The rider subscribe form links to MVTA's Privacy Policy and Terms beside the consent checkbox.",
        "A first request that wakes the paused dev database retries instead of failing with a server error.",
      ],
    },
  ],
};

export default entry;
