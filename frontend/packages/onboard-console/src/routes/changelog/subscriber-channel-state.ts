import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.189",
  date: "2026-09-11",
  sections: [
    {
      heading: "Fixed",
      items: [
        "Each rider alert channel now carries its own confirmation state, so confirming an email link can no longer make an unproven phone number eligible for text messages.",
      ],
    },
    {
      heading: "Added",
      items: [
        "Migration 117: groundwork for completing double opt-in — per-channel confirmation state, when a confirmation code was last tried, and why a subscriber opted out.",
        "The ACS SMS sender number and the rider app's public URL are declared in Bicep, so neither is erased by a routine infrastructure deploy.",
      ],
    },
  ],
};

export default entry;
