import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.324",
  date: "2026-10-16",
  sections: [
    {
      heading: "Added",
      items: [
        "The schedule review now keeps the evidence behind every flag: which stop pairs are placeholders and how many trips carry them, which timepoints the long gap sits between, which route a late bus comes off and how often, which hand-overs are tight and where. Each check also names who can fix it and how: MVTA scheduling, Avail's schedule export, operations, or nobody, because stop-free freeway miles are the route.",
        "Four new checks. Same running time all day: nine of nineteen routes schedule one running time for every trip from 5am to 7pm, so the schedule says traffic never changes. Most stops between timepoints: 420 has 20 stops between 157th Street Station and Rosemount Transit Station with nothing holding the bus. Implausible scheduled speed along the route. Typical recovery time, flagged at five minutes or less.",
        "Distances now read along the route, not as the crow flies: 490's longest stop-free hop is 22.1 miles along I-35W, not 14.9. The feed's distance unit is measured on every import rather than assumed.",
        "A route's detail is served by a new endpoint for the route view that comes next; the legend on Integrations & Data Health shows each check's owner and fix.",
      ],
    },
    {
      heading: "Changed",
      items: [
        "Needs migration 145. With it, the review is stored only when it changes and an unchanged one is confirmed in place, so feed-to-feed history is one row per change instead of one a day. Until it is applied the daily summary is kept as before and the route detail is unavailable.",
      ],
    },
  ],
};

export default entry;
