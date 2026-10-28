import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.6.45",
  date: "2026-10-28",
  sections: [
    {
      heading: "Changed",
      items: [
        "The Schedule Review page tests now wait for the selected route to be fetched instead of checking the moment the route list appears. The page fetches the route in an effect after the list renders, so under a busy CI runner the check could run first and fail a build that had nothing wrong with it. Nothing a person sees changes.",
      ],
    },
  ],
};

export default entry;
