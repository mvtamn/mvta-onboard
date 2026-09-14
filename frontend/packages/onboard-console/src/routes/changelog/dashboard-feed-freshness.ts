import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.210",
  date: "2026-09-14",
  sections: [
    {
      heading: "Changed",
      items: [
        "The Dashboard's Feeds & freshness panel now shows whether each feed is actually delivering. GTFS-Realtime and MVTA Connect each show their own state and when they last delivered. They previously reflected whether two console services answered, so a feed could be hours out of date while the Dashboard said \"Live data connected\".",
        "The Dashboard now refreshes itself once a minute while you have it open, and straight away when you switch back to it. It no longer checks in the background when the tab is hidden.",
        "Until the On-Demand monitor is connected, the Dashboard will show MVTA Connect as unavailable.",
      ],
    },
  ],
};

export default entry;
