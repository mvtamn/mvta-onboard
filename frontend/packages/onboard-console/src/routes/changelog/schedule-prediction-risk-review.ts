import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.319",
  date: "2026-10-14",
  sections: [
    {
      heading: "Added",
      items: [
        "Integrations & Data Health now shows where the published schedule makes arrival predictions worse, route by route. Every daily static GTFS import is checked for placeholder stop times, long gaps between timepoints, long distances between stops, tight turnarounds, buses coming off another route, impossible blocks, and run-time spread. Flagged values are highlighted, and each check says why it matters to the prediction a rider sees.",
        "On the feed that was live in September, routes 490 and 480 (Swiftly's two lowest-scoring routes) come out on top with 5 and 4 flags. The schedule describes almost nothing between their endpoints, so traffic decides their arrivals. On most local routes, a fifth or more of in-between stop times are placeholders one second apart.",
        "Needs migration 143. Until it is applied the import still runs normally, the review is not kept, and the page names the migration to run.",
      ],
    },
  ],
};

export default entry;
