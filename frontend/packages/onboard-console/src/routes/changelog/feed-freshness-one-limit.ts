import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.206",
  date: "2026-09-13",
  sections: [
    {
      heading: "Fixed",
      items: [
        "Service Risk no longer shows a fixed-route feed that has stopped answering as a quiet night with no trips. It now checks whether the feed itself answered recently, and shows \"Feed unavailable\" or \"Stale\" when it has not — even if the list of trips happens to be empty.",
        "The fixed-route feed no longer reads Stale for a few minutes every night as the last trips finish. Service Risk, the Integrations page and the background cleanup now judge the feed by the same 15-minute limit; Service Risk previously used 10.",
      ],
    },
  ],
};

export default entry;
