import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.116",
  date: "2026-09-06",
  sections: [
    {
      heading: "Changed",
      items: [
        "The KPI trust banners have moved from the top of each monitoring module to Administration > Integrations & Data Health, where every stream is shown together above Feed health. Each banner is now named for the module it covers. Stale-data guards inside the modules are unchanged.",
      ],
    },
  ],
};

export default entry;
