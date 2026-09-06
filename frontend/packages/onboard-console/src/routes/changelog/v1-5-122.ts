import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.122",
  date: "2026-09-06",
  sections: [
    {
      heading: "Changed",
      items: [
        "Administration > Integrations & Data Health is rebuilt. A summary strip answers first: how many KPI streams are current, how many feeds are reachable, and the oldest required ingestion. Each KPI stream is a card naming the module it gates, with its required and supporting dependencies as rows when something is wrong and as compact chips when it is current, sorted attention-first. Feed checks are a table with the failure reason under its row, and Check feeds is a proper button.",
      ],
    },
  ],
};

export default entry;
