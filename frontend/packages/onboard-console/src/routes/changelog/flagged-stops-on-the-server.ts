import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.284",
  date: "2026-09-21",
  sections: [
    {
      heading: "Added",
      items: [
        "The API now works out which stops the OTP Review Queue should put in front of a reviewer, at the early/late bias threshold an administrator has set. Until now the browser decided that for itself, against a threshold written into the console — so the value on the Administration page and the value actually used could differ.",
        "A stop is flagged only if it is on a fixed route. Excluding a stop on a special-event, on-demand or non-revenue route would change no figure, because the route is already outside official departure OTP. A stop that has already been excluded stays in the queue, so a past decision can be seen and reversed.",
      ],
    },
    {
      heading: "Changed",
      items: [
        "Nothing on screen changes yet. The Review Queue and the Threshold Tuner still use their own list; they move over to the API's in the next release, and stops on special-event and on-demand routes will leave the queue at that point.",
      ],
    },
  ],
};

export default entry;
